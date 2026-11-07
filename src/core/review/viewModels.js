import { maskForSharing } from '../ingest/mask.js';

/**
 * Groups review items into categories: unknownAccounts, possibleDuplicates, unparsed.
 * Each list is sorted newest first.
 *
 * @param {Array<object>} items - Array of review items from DB or state
 * @returns {{
 *   unknownAccounts: Array<object>,
 *   possibleDuplicates: Array<object>,
 *   unparsed: Array<object>,
 *   counts: { unknownAccounts: number, possibleDuplicates: number, unparsed: number, total: number }
 * }}
 */
export function groupReviewItems(items = []) {
  const unknownAccounts = [];
  const possibleDuplicates = [];
  const unparsed = [];

  const list = Array.isArray(items) ? items : [];

  for (const rawItem of list) {
    if (!rawItem) continue;
    const item = { ...rawItem };
    const type = item.type || item.payload?.type;

    if (type === 'unknown_account') {
      unknownAccounts.push(item);
    } else if (type === 'possible_duplicate' || type === 'duplicate') {
      possibleDuplicates.push(item);
    } else if (type === 'unparsed') {
      unparsed.push(item);
    }
  }

  const getDate = (it) => {
    const p = it.payload || {};
    return p.date || p.receivedAt || p.received_at || it.date || it.createdAt || it.created_at || '';
  };

  const sortByNewest = (a, b) => {
    const dateA = getDate(a);
    const dateB = getDate(b);
    if (dateA && dateB) {
      return dateB.localeCompare(dateA);
    }
    if (dateA) return -1;
    if (dateB) return 1;
    return (b.id || '').localeCompare(a.id || '');
  };

  unknownAccounts.sort(sortByNewest);
  possibleDuplicates.sort(sortByNewest);
  unparsed.sort(sortByNewest);

  const counts = {
    unknownAccounts: unknownAccounts.length,
    possibleDuplicates: possibleDuplicates.length,
    unparsed: unparsed.length,
    total: unknownAccounts.length + possibleDuplicates.length + unparsed.length,
  };

  return {
    unknownAccounts,
    possibleDuplicates,
    unparsed,
    counts,
  };
}

/**
 * Describes an unknown account review item.
 *
 * @param {object} item - Review item or payload
 * @param {number} heldCount - Count of messages waiting for this account
 * @param {Array<object>|object} accounts - Available accounts
 * @returns {{
 *   title: string,
 *   subtitle: string,
 *   suggestions: Array<object>
 * }}
 */
export function describeUnknownAccount(item, heldCount = 1, accounts = []) {
  const payload = (item && typeof item === 'object' && item.payload && typeof item.payload === 'object')
    ? item.payload
    : (item && typeof item === 'object' ? item : {});
  const rawIssuer = payload.issuer || '';
  const digits = payload.digits || '';
  const product = payload.product || '';

  const upper = String(rawIssuer || '').toUpperCase();
  const KNOWN_UPPER = new Set(['ICICI', 'HDFC', 'HSBC', 'IDFC', 'SBI', 'PNB', 'BOB', 'CITI', 'RBL', 'SCB', 'DBS', 'UPI', 'NEFT', 'IMPS']);
  let issuer = rawIssuer;
  if (KNOWN_UPPER.has(upper)) {
    issuer = upper;
  } else if (rawIssuer && rawIssuer.length <= 4) {
    issuer = upper;
  } else if (rawIssuer) {
    issuer = rawIssuer.charAt(0).toUpperCase() + rawIssuer.slice(1);
  }

  let title = '';
  if (digits) {
    title = `${issuer} ending ${digits}`.trim();
  } else if (product) {
    title = `${issuer} product ${product}`.trim();
  } else {
    title = `${issuer || 'Unknown'} account`.trim();
  }

  const count = typeof heldCount === 'number' && !isNaN(heldCount) ? heldCount : 1;
  const subtitle = `${count} ${count === 1 ? 'message' : 'messages'} waiting`;

  const accList = Array.isArray(accounts)
    ? accounts
    : (accounts && typeof accounts === 'object')
    ? Object.values(accounts)
    : [];

  // Exclude archived accounts
  const activeAccounts = accList.filter((acc) => acc && typeof acc === 'object' && !acc.archived && acc.archived !== 1 && acc.archived !== true);

  // Suggestions: accounts of the same issuer first
  const targetIssuer = String(issuer).trim().toLowerCase();
  const sameIssuer = [];
  const otherAccounts = [];

  for (const acc of activeAccounts) {
    const accIssuer = String(acc?.issuer || '').trim().toLowerCase();
    if (targetIssuer && accIssuer === targetIssuer) {
      sameIssuer.push(acc);
    } else {
      otherAccounts.push(acc);
    }
  }

  return {
    title,
    subtitle,
    suggestions: [...sameIssuer, ...otherAccounts],
  };
}

/**
 * Describes a possible duplicate review item comparing imported and manual expense(s).
 *
 * @param {object} item - Review item or payload
 * @param {Array<object>|object} expenses - Expenses map or list
 * @returns {{
 *   imported?: object,
 *   manual?: Array<object>,
 *   differences?: Array<string>,
 *   stale: boolean
 * }}
 */
export function describeDuplicate(item, expenses = []) {
  const payload = (item && typeof item === 'object' && item.payload && typeof item.payload === 'object')
    ? item.payload
    : (item && typeof item === 'object' ? item : {});
  const importedId = payload.importedId || payload.incomingExpenseId;
  const candidateIds = Array.isArray(payload.candidateIds)
    ? payload.candidateIds
    : Array.isArray(payload.candidateExpenseIds)
    ? payload.candidateExpenseIds
    : [];

  const expensesMap = Array.isArray(expenses)
    ? expenses.reduce((map, exp) => {
        if (exp?.id) map[exp.id] = exp;
        return map;
      }, {})
    : (expenses && typeof expenses === 'object')
    ? expenses
    : {};

  const imported = (importedId && expensesMap) ? expensesMap[importedId] : null;
  if (!imported || imported.deleted || imported.status === 'deleted') {
    return { stale: true };
  }

  const manualCandidates = candidateIds
    .map((id) => (expensesMap ? expensesMap[id] : null))
    .filter((exp) => exp && typeof exp === 'object' && !exp.deleted && exp.status !== 'deleted');

  if (manualCandidates.length === 0) {
    return { stale: true };
  }

  // Calculate field differences against primary manual candidate
  const primaryManual = manualCandidates[0];
  const differences = [];

  // Amount difference
  const impAmt = imported.amount_paise !== undefined ? imported.amount_paise : imported.amountPaise;
  const manAmt = primaryManual.amount_paise !== undefined ? primaryManual.amount_paise : primaryManual.amountPaise;
  if (impAmt !== manAmt) {
    differences.push('amount');
  }

  // Date difference
  const impDate = String(imported.date || '').slice(0, 10);
  const manDate = String(primaryManual.date || '').slice(0, 10);
  if (impDate !== manDate) {
    differences.push('date');
  }

  // Merchant difference
  const impMerchant = String(imported.merchant_raw || imported.merchantRaw || imported.brand || '').trim();
  const manMerchant = String(primaryManual.merchant_raw || primaryManual.merchantRaw || primaryManual.brand || '').trim();
  if (impMerchant !== manMerchant) {
    differences.push('merchant');
  }

  // Category difference
  const impCat = imported.category_id || imported.categoryId || null;
  const manCat = primaryManual.category_id || primaryManual.categoryId || null;
  if (impCat !== manCat) {
    differences.push('category');
  }

  // Note difference
  const impNote = String(imported.note || '').trim();
  const manNote = String(primaryManual.note || '').trim();
  if (impNote !== manNote) {
    differences.push('note');
  }

  return {
    imported,
    manual: manualCandidates,
    differences,
    stale: false,
  };
}

/**
 * Describes an unparsed review item.
 *
 * @param {object} item - Review item or payload
 * @returns {{
 *   preview: string,
 *   receivedAt: string|number,
 *   address: string
 * }}
 */
export function describeUnparsed(item) {
  const payload = (item && typeof item === 'object' && item.payload && typeof item.payload === 'object')
    ? item.payload
    : (item && typeof item === 'object' ? item : {});
  const body = typeof payload.body === 'string' ? payload.body : String(payload.body || '');
  const masked = maskForSharing(body).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const preview = masked.slice(0, 60);

  const receivedAt = payload.date || payload.receivedAt || payload.received_at || item?.date || '';
  const address = payload.address || item?.address || '';

  return {
    preview,
    receivedAt,
    address,
  };
}

/**
 * Formats scan summary counts into plain-text user-facing lines.
 * Omits zero lines except "Created 0 new expenses".
 *
 * @param {object} summary - Summary object from scanSms or planImport
 * @returns {Array<string>} Lines of text
 */
export function scanSummaryLines(summary = {}) {
  const lines = [];

  if (typeof summary.scanned === 'number') {
    const allowed = typeof summary.allowedCount === 'number'
      ? summary.allowedCount
      : summary.scanned - Number(summary.skippedSender || 0);
    lines.push(`Read ${summary.scanned} ${summary.scanned === 1 ? 'message' : 'messages'} (${allowed} from allowed senders)`);
  }

  if (summary.stopReason) {
    lines.push(`Stopped: ${summary.stopReason}`);
  }

  const createdCount = Number(summary.created ?? summary.imported ?? 0);
  if (createdCount === 0) {
    lines.push('Created 0 new expenses');
  } else {
    lines.push(`Created ${createdCount} ${createdCount === 1 ? 'expense' : 'expenses'}`);
  }

  const heldCount = Number(summary.held ?? 0);
  if (heldCount > 0) {
    lines.push(`${heldCount} ${heldCount === 1 ? 'message is' : 'messages are'} waiting for an account`);
  }

  const duplicateTxnCount = Number(summary.duplicateTransaction ?? 0);
  if (duplicateTxnCount > 0) {
    lines.push(`${duplicateTxnCount} duplicate ${duplicateTxnCount === 1 ? 'transaction' : 'transactions'}`);
  }

  const possibleDupCount = Number(summary.possibleDuplicates ?? 0);
  if (possibleDupCount > 0) {
    lines.push(`${possibleDupCount} possible ${possibleDupCount === 1 ? 'duplicate' : 'duplicates'}`);
  }

  const unparsedCount = Number(summary.unparsed ?? 0);
  if (unparsedCount > 0) {
    lines.push(`${unparsedCount} unparsed ${unparsedCount === 1 ? 'message' : 'messages'}`);
  }

  const ignoredCount = Number(summary.ignored ?? 0);
  if (ignoredCount > 0) {
    lines.push(`${ignoredCount} ignored ${ignoredCount === 1 ? 'message' : 'messages'}`);
  }

  const refundLinkedCount = Number(summary.refundLinked ?? 0);
  if (refundLinkedCount > 0) {
    lines.push(`${refundLinkedCount} ${refundLinkedCount === 1 ? 'refund' : 'refunds'} linked`);
  }

  const duplicateMsgCount = Number(summary.duplicateMessage ?? 0);
  if (duplicateMsgCount > 0) {
    lines.push(`${duplicateMsgCount} duplicate ${duplicateMsgCount === 1 ? 'message' : 'messages'}`);
  }

  return lines;
}

/**
 * Returns total count of open review items.
 *
 * @param {Array<object>|object} items - Review items list or grouped object
 * @returns {number}
 */
export function reviewBadgeCount(items) {
  if (!items) return 0;

  if (Array.isArray(items)) {
    return items.filter((it) => it && it.status !== 'resolved').length;
  }

  if (typeof items === 'object') {
    if (items.counts?.total !== undefined) {
      return items.counts.total;
    }
    const unknown = items.unknownAccounts?.length || 0;
    const dups = items.possibleDuplicates?.length || 0;
    const unparsed = items.unparsed?.length || 0;
    return unknown + dups + unparsed;
  }

  return 0;
}
