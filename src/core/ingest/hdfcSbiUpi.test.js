import { describe, it, expect } from 'vitest';
import { parseSms } from './index.js';
import { sha256Hex } from './registry.js';
import { planImport, applyImport, reprocessOpenUnparsed } from './pipeline.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../sync/testing/memoryStorage.js';
import { createWriter } from '../sync/writer.js';
import { migrate, loadStateFromDb } from '../db/index.js';
import { isLikelyBankMessage } from '../review/sendersCleanup.js';

// Synthetic layouts only: names, references and account numbers are invented.
const hdfcSent = (amt, payee, date, ref) =>
  `Sent Rs.${amt}\nFrom HDFC Bank A/C *5678\nTo ${payee}\nOn ${date}\nRef ${ref}\nNot You?\nCall 18000000000/SMS BLOCK UPI to 7000000000`;
const sbiDebit = (amt, date, payee, ref) =>
  `Dear UPI user A/C X9012 debited by ${amt} on date ${date} trf to ${payee} Refno ${ref} If not u? call-1800000000 for other services-18000000-SBI`;
const sbiCredit = (amt, date, name, ref) =>
  `Dear SBI User, your A/c X9012-credited by Rs.${amt} on ${date} transfer from ${name} Ref No ${ref} -SBI`;

const accounts = [
  { id: 'acc_hdfc_w', issuer: 'HDFC', lastDigits: '5678', type: 'bank' },
  { id: 'acc_sbi_w', issuer: 'SBI', lastDigits: '9012', type: 'bank' },
];
const parse = (body, ownerNames = []) => parseSms({ address: 'BANK', body, date: 1 }, { accounts, ownerNames });

describe('HDFC UPI account debit', () => {
  it('reads a payment', () => {
    const { status, txn } = parse(hdfcSent('443.04', 'SAMPLE MOBILITY INDIA PRIVAT', '28/10/26', '111111111111'));
    expect(status).toBe('parsed');
    expect(txn).toMatchObject({
      issuer: 'hdfc', accountId: 'acc_hdfc_w', amountPaise: 44304, direction: 'debit', kind: 'spend', date: '2026-10-28',
      merchantRaw: 'SAMPLE MOBILITY INDIA PRIVAT', mode: 'upi', refNo: '111111111111', dedupeKey: 'ref:111111111111',
    });
  });
  it('treats a payment to a household member as a transfer', () => {
    expect(parse(hdfcSent('90.00', 'TEST OWNER', '06/11/26', '111111111112'), ['Test Owner']).txn.kind).toBe('transfer');
  });
  it('holds an unknown account for review', () => {
    const { txn } = parseSms({ address: 'BANK', body: hdfcSent('1.00', 'X', '06/11/26', '111111111113'), date: 1 }, { accounts: [] });
    expect(txn).toMatchObject({ accountId: null, accountHint: { issuer: 'hdfc', digits: '5678', accountType: 'bank' } });
  });
  it('leaves the card layout working', () => {
    const body = 'A transaction of Rs. 10.00 was made using your HDFC Bank Pixel Play Credit Card at shop@hdfcbank via UPI 111111111114 on 01/11/26 at 10:00. Not you?';
    expect(parse(body).status).toBe('parsed');
  });
});

describe('SBI UPI', () => {
  it('reads a debit with no currency word', () => {
    const { status, txn } = parse(sbiDebit('336.00', '03Aug26', 'SAMPLE STORE', '222222222222'));
    expect(status).toBe('parsed');
    expect(txn).toMatchObject({ issuer: 'sbi', accountId: 'acc_sbi_w', amountPaise: 33600, direction: 'debit', kind: 'spend', date: '2026-08-03', merchantRaw: 'SAMPLE STORE', mode: 'upi', dedupeKey: 'ref:222222222222' });
  });
  it('reads a credit as income', () => {
    expect(parse(sbiCredit('1', '03Aug26', 'Sample Solutions Private Limited', '222222222223')).txn).toMatchObject({ amountPaise: 100, direction: 'credit', kind: 'income', merchantRaw: 'Sample Solutions Private Limited' });
  });
  it('reads a credit from a household member as a transfer', () => {
    expect(parse(sbiCredit('500.00', '03Aug26', 'TEST OWNER', '222222222224'), ['Test Owner']).txn.kind).toBe('transfer');
  });
  it('sends an unrecognised SBI debit to review instead of guessing', () => {
    expect(parse('Your SBI A/c X9012 was debited Rs.50 somehow in a new layout').status).toBe('unparsed');
  });
  it('recognises SBI as a bank sender, but not its mutual fund', () => {
    const msg = { address: 'JK-SBIUPI-S', body: sbiDebit('1.00', '03Aug26', 'X', '222222222225'), date: 1 };
    expect(isLikelyBankMessage(msg, null, { accounts })).toBe(true);
    const fund = { address: 'JK-SBIMF-S', body: 'Your SIP of Rs.100 under Folio No.1 is due for debit from your account on 05-09-2026.', date: 1 };
    expect(isLikelyBankMessage(fund, null, { accounts })).toBe(false);
  });
});

// Layouts found by a masked audit of the inbox. All values are invented.
describe('more HDFC and SBI layouts', () => {
  const received = Date.UTC(2026, 10, 6, 6, 0, 0);
  const at = (body, date = received, ownerNames = []) => parseSms({ address: 'BANK', body, date }, { accounts, ownerNames });

  it('reads Amt Sent, taking the year from when the SMS arrived', () => {
    const body = 'Amt Sent Rs.60.50\nFrom HDFC Bank A/C *5678\nTo SAMPLE SHOP\nOn 05-11\nRef 444444444444\nNot You? Call 18000000000/SMS BLOCK UPI to 7000000000';
    expect(at(body).txn).toMatchObject({ issuer: 'hdfc', amountPaise: 6050, date: '2026-11-05', merchantRaw: 'SAMPLE SHOP', dedupeKey: 'ref:444444444444' });
  });
  it('Amt Sent received just after new year belongs to the old year', () => {
    const body = 'Amt Sent Rs.1.00\nFrom HDFC Bank A/C *5678\nTo X\nOn 31-12\nRef 444444444445\nNot You?';
    expect(at(body, Date.UTC(2027, 0, 1, 6)).txn.date).toBe('2026-12-31');
  });
  it('reads an HDFC Credit Alert', () => {
    const body = 'Credit Alert!\nRs.250.00 credited to HDFC Bank A/c XX5678 on 05-11-26 from VPA someone@okbank (UPI 444444444446)\n';
    expect(at(body).txn).toMatchObject({ direction: 'credit', kind: 'income', amountPaise: 25000, date: '2026-11-05', merchantRaw: 'someone@okbank', dedupeKey: 'ref:444444444446', accountId: 'acc_hdfc_w' });
  });
  it('reads an HDFC credit linked to a VPA', () => {
    const body = 'HDFC Bank: Rs. 1200.00 credited to a/c XXXXXX5678 on 05-11-26 by a/c linked to VPA someone@okbank (UPI Ref No  444444444447).';
    expect(at(body).txn).toMatchObject({ direction: 'credit', amountPaise: 120000, merchantRaw: 'someone@okbank', dedupeKey: 'ref:444444444447' });
  });
  it('reads an SBI UPI credit with no sender name', () => {
    const body = 'Dear SBI UPI User, ur A/cX9012 credited by Rs500 on 03Feb26 by  (Ref no 555555555551)';
    expect(at(body).txn).toMatchObject({ issuer: 'sbi', direction: 'credit', kind: 'income', amountPaise: 50000, date: '2026-02-03', merchantRaw: 'UPI credit', dedupeKey: 'ref:555555555551' });
  });
  it('reads the other SBI UPI debit wording', () => {
    const body = 'Dear SBI User, your A/c X9012-debited by Rs75.5 on 03Jul26 transfer to SAMPLE SHOP Ref No 555555555552. If not done by u, fwd this SMS to 9000000000/Call 9000000000 or 18000000000 to block UPI -SBI';
    expect(at(body).txn).toMatchObject({ direction: 'debit', kind: 'spend', amountPaise: 7550, merchantRaw: 'SAMPLE SHOP', dedupeKey: 'ref:555555555552' });
  });
  it('reads the short SBI UPI debit', () => {
    const body = 'Rs120.5 shop@okbank UPI frm A/cX9012 on 03Jul26 RefNo 555555555553. If not done by u, fwd this SMS to 9000000000/Call 9000000000 or 18000000000 to block UPI -SBI';
    expect(at(body).txn).toMatchObject({ direction: 'debit', amountPaise: 12050, merchantRaw: 'shop@okbank', dedupeKey: 'ref:555555555553' });
  });
  it('reads an SBI NEFT credit as income', () => {
    const body = 'Dear Customer, INR 75,000.00 credited to your A/c No XX9012 on 31/10/2026 through NEFT with UTR CMS1111111111111 by SAMPLE EMPLOYER LTD, INFO: SALOCT26 CMS1111111111111 DIGICH01 N-SBI';
    expect(at(body).txn).toMatchObject({ direction: 'credit', kind: 'income', amountPaise: 7500000, date: '2026-10-31', merchantRaw: 'SAMPLE EMPLOYER LTD', mode: 'netbanking', dedupeKey: 'ref:CMS1111111111111' });
  });
  it('reads an SIP allotment as Fixed, held until its account exists', () => {
    const body = 'Dear Investor, Purchase - Systematic in Folio 12345678 in Fund : Sample Small Cap Fund Reg Growth for date 07-Sep-2026 for amount of INR 4,999.75 at NAV of 186.9486 is processed and 26.744 units have been allotted - SBIMF';
    expect(at(body).txn).toMatchObject({ issuer: 'sbimf', accountId: null, accountHint: { issuer: 'sbimf', digits: '5678', accountType: 'bank' }, direction: 'debit', kind: 'fixed', amountPaise: 499975, date: '2026-09-07', merchantRaw: 'Sample Small Cap Fund Reg Growth' });
  });
  it('keeps two funds on one date apart', () => {
    const sip = (fund, tax = '') => `Dear Investor, Purchase - Systematic ${tax}in Folio 12345678 in Fund : ${fund} for date 05-Nov-2026 for amount of INR 4,999.75 at NAV of 1.0 is processed and 1.000 units have been allotted - SBIMF`;
    expect(at(sip('Fund A')).txn.dedupeKey).not.toBe(at(sip('Fund B', 'U/s 80C of IT Act 1961 ')).txn.dedupeKey);
  });
  it('ignores HDFC sweep liquidation notices', () => {
    expect(at('FD XX9012 of INR 5.00 will be liquidated for INR 5.00 for sweep in debit from A/c XX5678. Add money to your HDFC Bank A/c to avoid liquidation.').status).toBe('ignored');
  });
  it('sends SBI transfer debits with no payee to Review', () => {
    expect(at('Dear Customer, Your A/C XXXXX129012 has a debit by transfer of Rs 5,000.00 on 05/11/26. Avl Bal Rs 1,000.00.-SBI').status).toBe('unparsed');
  });
  it('sends unrecognised payments with no usual keyword to Review, not silence', () => {
    expect(at('Amt Sent Rs.5.00 From HDFC Bank A/C *5678 in a new layout').status).toBe('unparsed');
    expect(at('Dear UPI user A/C X9012 debited by 5.00 in a new layout -SBI').status).toBe('unparsed');
  });
});

describe('messages that must not become expenses', () => {
  const cases = {
    'first UPI notice, which would double count the debit': 'Ur 1st UPI Txn of Rs100.00 frm SBIN A/cX9012 is successful. If it\'s not u, visit ur branch or mail us at support@example.com',
    'SIP due reminder': 'Your SIP of Rs.100 under Folio No.1 is due for debit from your account on 05-09-2026.  Units will be allotted basis realization of funds in the Mutual Fund account - SBIMF',
    'biller receipt': 'Dear Customer, Payment of Rs. 700.00 for your JioHome connection with JioFixedVoice Number +910000000000 through UPI Payments has been received on 21-Oct-26. Thank You!',
  };
  for (const [name, body] of Object.entries(cases)) {
    it(`ignores ${name}`, () => expect(parse(body).status).toBe('ignored'));
  }
  it('does not treat statement links or portfolio notices as financial', () => {
    expect(parse('Dear Investor, Please Click on https://example.com and enter PAN/Folio to view SOA for recent trxn in folio no XXXXX1 - SBIMF').status).toBe('unknown');
    expect(parse('Dear investor, your Monthly CAS of PAN xxxxxx1E for the quarter ending SEP-26 is emailed on x@example.com - CDSL').status).toBe('unknown');
  });
});

describe('messages scanned before their layout was supported', () => {
  async function setup() {
    const db = await createSqljsAdapter();
    await migrate(db);
    const writer = createWriter({ deviceId: 'dev-a', storage: createMemoryStorage(), db });
    await writer.init();
    await writer.writeMany(accounts.map((a) => ({ type: 'account.upserted', data: a })));
    return { db, writer };
  }
  const body = hdfcSent('90.00', 'SAMPLE PERSON', '06/11/26', '333333333333');
  const hash = sha256Hex(`BANK|5|${body}`);
  async function storeUnparsed(db, id, status = 'open') {
    await db.exec('INSERT INTO raw_messages (hash, kind, body, received_at, parsed) VALUES (?, ?, ?, ?, ?);', [hash, 'unparsed', body, 'x', JSON.stringify({ address: 'BANK', date: 5 })]);
    await db.exec('INSERT INTO review_queue (id, type, payload, status) VALUES (?, ?, ?, ?);', [id, 'unparsed', JSON.stringify({ id, reviewId: id, type: 'unparsed', status: 'open', rawHash: hash, address: 'BANK', date: 5, body }), status]);
  }
  const run = async (db, writer) => reprocessOpenUnparsed({ db, writer, state: await loadStateFromDb(db), ownerNames: [] });

  it('imports an open item once and clears it', async () => {
    const { db, writer } = await setup();
    await storeUnparsed(db, 'rv_1');
    expect((await run(db, writer)).created).toBe(1);
    expect((await db.query('SELECT merchant_raw FROM expenses;'))[0].merchant_raw).toBe('SAMPLE PERSON');
    expect((await db.query("SELECT status FROM review_queue WHERE id='rv_1';"))[0].status).toBe('resolved');
    expect((await db.query('SELECT kind FROM raw_messages;'))[0].kind).toBe('parsed');
    expect((await run(db, writer)).created).toBe(0);
    expect((await db.query('SELECT count(*) c FROM expenses;'))[0].c).toBe(1);
  });

  it('leaves alone an item the user already dismissed', async () => {
    const { db, writer } = await setup();
    await storeUnparsed(db, 'rv_1', 'resolved');
    expect((await run(db, writer)).created).toBe(0);
    expect((await db.query('SELECT count(*) c FROM expenses;'))[0].c).toBe(0);
  });

  it('review payload carries the account type for the create-account form', async () => {
    const { db, writer } = await setup();
    const state = await loadStateFromDb(db);
    const plan = planImport({ messages: [{ address: 'BANK', date: 9, body: hdfcSent('1.00', 'X', '06/11/26', '333333333334').replace('5678', '4444') }], ctx: { accounts: state.accounts, brands: {}, rules: {}, ownerNames: [] }, state, seenHashes: new Set(), allowlist: ['BANK'] });
    await applyImport({ plan, writer, db });
    expect(plan.reviewItems[0].payload).toMatchObject({ issuer: 'hdfc', digits: '4444', accountType: 'bank' });
  });
});
