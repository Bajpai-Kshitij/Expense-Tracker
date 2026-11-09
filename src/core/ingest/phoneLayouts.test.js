import { describe, it, expect } from 'vitest';
import { parseSms } from './index.js';

// Layouts found by a masked audit. Names, references, amounts and numbers are invented.
const accounts = [
  { id: 'a_idfc', issuer: 'IDFC', lastDigits: '1111' },
  { id: 'a_axis_c', issuer: 'Axis', lastDigits: '2222' },
  { id: 'a_axis_s', issuer: 'Axis', lastDigits: '3333' },
  { id: 'a_icici_c', issuer: 'ICICI', lastDigits: '4444' },
  { id: 'a_icici_s', issuer: 'ICICI', lastDigits: '555' },
  { id: 'a_pixel', issuer: 'HDFC', name: 'HDFC Pixel Play 6666' },
];
const received = Date.UTC(2026, 10, 6, 6, 0, 0);
const parse = (body, ownerNames = []) => parseSms({ address: 'BANK', body, date: received }, { accounts, ownerNames });

describe('IDFC FIRST', () => {
  it('reads a spend with time', () => {
    const { status, txn } = parse('Transaction Successful! INR 500.50 spent on your IDFC FIRST Bank Credit Card ending XX1111 at SAMPLE SHOP on 05 NOV 2026 at 09:15 PM Avbl Limit: INR 1000.00 If not done by you, call 100 for dispute');
    expect(status).toBe('parsed');
    expect(txn).toMatchObject({ issuer: 'idfc', accountId: 'a_idfc', amountPaise: 50050, direction: 'debit', kind: 'spend', date: '2026-11-05', time: '21:15:00', merchantRaw: 'SAMPLE SHOP', mode: 'card' });
    expect(txn.dedupeKey).toContain('|avl100000');
  });
  it('reads the hyphenated date with PM. and no-time wordings', () => {
    expect(parse('Transaction Successful! INR 5.00 spent on your IDFC FIRST Bank Credit Card ending XX1111 at SHOP on 05-NOV-2026 at 09:15 PM. Avbl limit: Rs.9.50. If not done by you, call 1').txn).toMatchObject({ date: '2026-11-05', time: '21:15:00', availLimitPaise: 950 });
    expect(parse('Happy Shopping! INR 5.00 spent on your IDFC FIRST Bank Credit Card XX1111 at SHOP on 05-Nov-2026 Available limit: INR 9 Activate UPI: x').txn).toMatchObject({ date: '2026-11-05' });
  });
  it('reads the wording without ending or time', () => {
    expect(parse('Happy Shopping! INR 20 spent on your IDFC FIRST Bank Credit Card XX1111 at SHOP ONE on 05 Nov 2026 Available limit: INR 90 Activate UPI: x').txn).toMatchObject({ amountPaise: 2000, date: '2026-11-05', merchantRaw: 'SHOP ONE' });
  });
  it('reads a card payment as a transfer', () => {
    expect(parse('Thank you for payment of INR 1,000.00 towards your FIRST Millennia Credit Card XX1111 on 05 Feb 2026. IDFC FIRST Bank').txn).toMatchObject({ direction: 'credit', kind: 'transfer', amountPaise: 100000, date: '2026-02-05', linkHint: { type: 'card_payment', side: 'card', cardLast4: '1111' } });
  });
});

describe('Axis', () => {
  it('reads the Spent Card layout', () => {
    expect(parse('Spent\nCard no. XX2222\nINR 300\n05-11-26 10:11:12\nSAMPLE CAFE\nAvl Lmt INR 900.50\nSMS BLOCK 2222 to 900000, if not you - Axis Bank').txn).toMatchObject({ accountId: 'a_axis_c', amountPaise: 30000, date: '2026-11-05', time: '10:11:12', merchantRaw: 'SAMPLE CAFE', mode: 'card', availLimitPaise: 90050 });
  });
  it('reads a UPI debit in both wordings', () => {
    const a = parse('Debit\nINR 700.00\nA/c no. XX3333\n05-11-26 10:11:12\nUPI/P2A/111111111111/SAMPLE PERSON  /State Ban\nBAL INR 5.00\nSMS Cust ID to 900000, if not you - Axis Bank').txn;
    expect(a).toMatchObject({ accountId: 'a_axis_s', amountPaise: 70000, kind: 'spend', merchantRaw: 'SAMPLE PERSON', mode: 'upi', dedupeKey: 'ref:111111111111' });
    expect(parse('INR 700.00 debited\nA/c no. XX3333\n05-11-26, 10:11:12\nUPI/P2M/111111111112/SAMPLE SHOP\nNot you? SMS Cust ID to 900000\nAxis Bank').txn).toMatchObject({ merchantRaw: 'SAMPLE SHOP', dedupeKey: 'ref:111111111112' });
  });
  it('treats a UPI debit to a household member as a transfer', () => {
    expect(parse('INR 7.00 debited\nA/c no. XX3333\n05-11-26, 10:11:12\nUPI/P2A/111111111113/TEST OWNER\nNot you? x\nAxis Bank', ['Test Owner']).txn.kind).toBe('transfer');
  });
  it('reads a bank-side card payment as a transfer', () => {
    expect(parse('Debit INR 800.00\nAxis Bank A/c XX3333\n05-11-26 10:11:12\nSBI-Card Payment\nWhatsApp BAL to 900000\nNot You? x').txn).toMatchObject({ kind: 'transfer', amountPaise: 80000 });
    expect(parse('Debit\nINR 800.00\nAxis Bank A/c no. XX3333\n05-11-26 10:11:12 IST\nCreditCard Payment HDFC 26\nChk Bal axisbank.com/W\nSMS Cust ID to 900000, if not you.').txn).toMatchObject({ kind: 'transfer' });
  });
  it('keeps reading ACH debits as Fixed in the a/c no. wording', () => {
    expect(parse('Debit\nINR 900.00\nAxis Bank A/c no. XX3333\n05-11-26 10:11:12 IST\nACH-DR-SAMPLEFUND-111\nChk Bal axisbank.com/W\nSMS Cust ID to 900000, if not you.').txn).toMatchObject({ kind: 'fixed', amountPaise: 90000 });
  });
  it('sends an unknown narration to Review', () => {
    expect(parse('Debit INR 1.00\nAxis Bank A/c XX3333\n05-11-26 10:11:12\nSOMETHING-NEW-1\nNot You? x').status).toBe('unparsed');
  });
  it('reads a UPI credit', () => {
    expect(parse('INR 50.00 credited to A/c no. XX3333 on 05-11-26 at 10:11:12 IST. Info- UPI/P2A/111111111114/SAMPLE PERSON/ICICI Ban - Axis Bank').txn).toMatchObject({ direction: 'credit', kind: 'income', merchantRaw: 'SAMPLE PERSON', dedupeKey: 'ref:111111111114' });
  });
  it('reads the other card payment wording with the same key as the first', () => {
    const a = parse('Dear Customer, payment of Rs. 999 towards your Axis Bank Credit Card XXXX2222 has been received on 05-Nov-26. Thank You.').txn;
    const b = parse('Payment of INR 999 has been received towards your Axis Bank Credit Card XX2222 on 05-11-26 - Axis Bank').txn;
    expect(a).toMatchObject({ direction: 'credit', kind: 'transfer', linkHint: { cardLast4: '2222' } });
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
  it('reads card cashback as income, dated when the SMS arrived', () => {
    expect(parse('Congratulations! Cashback of INR 25 has been credited to your Axis Bank Flipkart Visa Credit Card XX2222 towards your last month spends - Axis Bank').txn).toMatchObject({ direction: 'credit', kind: 'income', amountPaise: 2500, date: '2026-11-06', merchantRaw: 'Cashback' });
  });
});

describe('ICICI', () => {
  it('reads spent on card in both currencies', () => {
    expect(parse('INR 100.00 spent on ICICI Bank Card XX4444 on 05-Oct-26 at SAMPLE SHOP. Avl Lmt: INR 500.00. To dispute,call 1/SMS BLOCK 4444 to 9').txn).toMatchObject({ accountId: 'a_icici_c', amountPaise: 10000, date: '2026-10-05', merchantRaw: 'SAMPLE SHOP', mode: 'card', availLimitPaise: 50000 });
    expect(parse('Rs 1,234.50 spent on ICICI Bank Card XX4444 on 05-Sep-26 at SHOP E. Avl Lmt: Rs 99.00. To dispute, call 1/SMS BLOCK 4444 to 9. To convert this txn to EMI give a missed call').txn).toMatchObject({ amountPaise: 123450, merchantRaw: 'SHOP E' });
  });
  it('reads a UPI debit with a comma before the payee', () => {
    expect(parse('ICICI Bank Acct XX555 debited for Rs 900.00 on 05-May-26, SAMPLE PERSON  credited. UPI:222222222222. Call 1 for dispute/SMS BLOCK 555 to 9.').txn).toMatchObject({ accountId: 'a_icici_s', merchantRaw: 'SAMPLE PERSON', dedupeKey: 'ref:222222222222' });
  });
  it('reads a subscription AutoPay as Fixed', () => {
    expect(parse('Rs 649.00 debited from ICICI Bank Savings Account XX555 on 05-Oct-26 towards Sample Stream for Subscription for AutoPay Retrieval Ref No.222222222223').txn).toMatchObject({ kind: 'fixed', amountPaise: 64900, merchantRaw: 'Sample Stream', dedupeKey: 'ref:222222222223' });
  });
  it('reads a merchant mandate AutoPay as Fixed', () => {
    expect(parse('Rs 199.00 debited from ICICI Bank Savings Account XX555 on 05-Oct-26 towards Sample Stream for MERCHANTMANDATE AutoPay Retrieval Ref No.222222222224').txn).toMatchObject({ kind: 'fixed', dedupeKey: 'ref:222222222224' });
  });
  it('reads an auto debit as a transfer, and leaves unnamed bill payments for Review', () => {
    expect(parse('ICICI Bank Acc XX555 debited Rs. 5,000.00 on 05-Oct-26 InfoATD*Auto Debi.Avl Bal Rs. 9.00.To dispute call 1 or SMS BLOCK 555 to 9').txn).toMatchObject({ direction: 'debit', kind: 'transfer', amountPaise: 500000, date: '2026-10-05' });
    expect(parse('ICICI Bank Acc XX555 debited Rs. 5.00 on 05-Oct-26 InfoBIL*BPAY*1234.Avl Bal Rs. 9.00.To dispute call 1 or SMS BLOCK 555 to 9').status).toBe('unparsed');
  });
  it('reads a card payment as a transfer', () => {
    expect(parse('Dear Customer, Payment of INR 1,000.00 has been received on your ICICI Bank Credit Card Account 4xxx4444 on 05-Oct-26.Thank you.').txn).toMatchObject({ accountId: 'a_icici_c', direction: 'credit', kind: 'transfer', linkHint: { cardLast4: '4444' } });
  });
});

describe('HDFC and FASTag', () => {
  it('reads a Pixel card payment as a transfer', () => {
    expect(parse('Dear Customer,\nPayment of Rs 2000.00 received towards HDFC Bank Pixel Play Credit Card on 05/10/26 10:11.\nClick x to view limit.').txn).toMatchObject({ accountId: 'a_pixel', direction: 'credit', kind: 'transfer', amountPaise: 200000, date: '2026-10-05' });
  });
  it('reads a FASTag toll', () => {
    expect(parse('Rs.105.50 toll paid at Sample Main Plaza 12 on 05-Aug-2026 09:15:00 PM for UP00AA1234 via FASTag. Bal Rs.-9.00. Call 1 to report issue. - IndusInd Bank').txn).toMatchObject({ issuer: 'indusind', accountHint: { issuer: 'indusind', digits: '1234' }, amountPaise: 10550, kind: 'spend', date: '2026-08-05', time: '21:15:00', merchantRaw: 'Sample Main Plaza 12' });
  });
});

describe('notices that are not transactions', () => {
  const cases = {
    'NACH notice repeating an ACH debit': 'NACH debit towards SAMPLE FUND for INR 900.00 with REF UTIB111 has been successfully processed in A/c no. XX3333 today - Axis Bank',
    'statement generated': 'Statement for your Axis Bank Credit Card XX2222 of INR 900 has been generated with due date 05/11/26. Minimum amount due is INR 90.',
    'e-statement': 'E-statement of your Axis Bank Credit Card no. XX2222 has been generated. Total Amount Due INR 90, Minimum Amount Due INR 9, Due date 05/11/26.',
    'IDFC bill due': 'Your IDFC FIRST Bank Credit Card XX1111 bill due by 05 Nov 2026 Total Amt: INR 900 Min Amt: INR 90 Pay:x',
    'HDFC statement': 'HDFC Bank Pixel Credit Card XX6666 Statement Total Amount Due Rs 90. Min Amount Due Rs 9 Due By: 05-Nov-26',
    'limit offer': 'Manage spends effectively by increasing the limit on ICICI Bank Credit Card XX4444 from Rs 9 to Rs 90.',
    'future auto debit': 'Payment of INR 90 for Google Play will be auto debited via Axis Bank Card no. XX2222 by 05-11-26.',
    'scheduled mandate': 'Dear UPI User, UPI AutoPay for Sample debit of Rs.90 is scheduled on .05-11-26, x Please ensure sufficient balance in your account. -SBI',
    'EMI conversion notice': 'Dear Customer, your transaction of Rs 900 using ICICI Bank Credit Card XX4444 has been converted into EMI on 05-Oct-26.',
  };
  for (const [name, body] of Object.entries(cases)) {
    it(`ignores ${name}`, () => expect(parse(body).status).toBe('ignored'));
  }
});
