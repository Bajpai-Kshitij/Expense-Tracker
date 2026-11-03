import { planImport, applyImport } from '../core/ingest/pipeline.js';
import { sanitizeAllowlist } from '../core/ingest/senders.js';

let isScanRunning = false;

/**
 * Maps native and plugin errors into user-friendly messages for SMS import.
 *
 * @param {Error|object|string} err
 * @returns {string} User-facing message
 */
export function mapPermissionError(err) {
  if (!err) return '';
  const msg = typeof err === 'string' ? err : err.message || '';
  const code = err.code || '';

  if (
    code === 'PERMISSION_DENIED' ||
    code === 'PERMISSION_ERROR' ||
    /permission.*denied/i.test(msg) ||
    /sms.*permission/i.test(msg) ||
    /denied/i.test(msg)
  ) {
    return "SMS permission is needed. If Android blocks it, open the app's settings > Allow restricted settings, then try again.";
  }

  if (code === 'NO_SENDERS_CONFIGURED') {
    return 'Choose and save your bank senders first.';
  }

  return msg || 'An unknown error occurred while accessing SMS.';
}

/**
 * Orchestrates scanning SMS from the device in batches of 500,
 * planning and applying imports incrementally, tracking the watermark.
 * 
 * @param {object} params
 * @param {Function} params.readSms - Native or mock readSms function ({ sinceEpochMs, limit })
 * @param {object} params.db - SQLite database adapter
 * @param {object} params.writer - LogWriter instance
 * @param {Function} params.getState - Function returning fresh reducer state
 * @param {object} [params.settings] - Fallback settings object
 * @param {number|Function} [params.now=Date.now] - Current clock
 * @param {number} [params.sinceDays=60] - Initial lookback days if no watermark exists
 * @param {boolean} [params.ignoreWatermark=false] - Rescan ignoring previous watermark
 * @param {Function} [params.onProgress] - Optional callback receiving { scanned: number }
 * @returns {Promise<object>} Aggregated plan summary or { busy: true }
 */
export async function scanSms({
  readSms,
  db,
  writer,
  getState,
  settings = {},
  now = () => Date.now(),
  sinceDays = 60,
  ignoreWatermark = false,
  onProgress,
}) {
  if (isScanRunning) {
    return { busy: true };
  }

  isScanRunning = true;
  try {
    // 1. Retrieve allowlist
    let allowlist = null;
    if (db && typeof db.query === 'function') {
      try {
        const rows = await db.query('SELECT value FROM settings WHERE key = ?;', [
          'sms_senders',
        ]);
        if (rows[0]?.value) {
          allowlist = JSON.parse(rows[0].value);
        }
      } catch {}
    }
    if (!allowlist && settings?.sms_senders) {
      allowlist =
        typeof settings.sms_senders === 'string'
          ? JSON.parse(settings.sms_senders)
          : settings.sms_senders;
    }

    allowlist = sanitizeAllowlist(allowlist);

    if (!allowlist || allowlist.length === 0) {
      const err = new Error('No SMS senders configured. Choose and save your bank senders first.');
      err.code = 'NO_SENDERS_CONFIGURED';
      err.userMessage = 'Choose and save your bank senders first.';
      throw err;
    }

    // 2. Compute watermark start time
    const nowMs = typeof now === 'function' ? now() : (now || Date.now());
    let lastScanMs = null;
    let lastScanReadCount = null;
    if (db && typeof db.query === 'function') {
      try {
        const rows = await db.query('SELECT value FROM settings WHERE key = ?;', [
          'sms_last_scan_ms',
        ]);
        if (rows[0]?.value) {
          lastScanMs = Number(rows[0].value);
        }
        const countRows = await db.query('SELECT value FROM settings WHERE key = ?;', [
          'sms_last_scan_read_count',
        ]);
        if (countRows[0]?.value !== undefined && countRows[0]?.value !== null) {
          lastScanReadCount = Number(countRows[0].value);
        }
      } catch {}
    }
    if (lastScanMs === null && settings?.sms_last_scan_ms) {
      lastScanMs = Number(settings.sms_last_scan_ms);
    }
    if (lastScanReadCount === null && settings?.sms_last_scan_read_count !== undefined) {
      lastScanReadCount = Number(settings.sms_last_scan_read_count);
    }

    const days = typeof sinceDays === 'number' ? sinceDays : 60;
    const defaultSince = nowMs - days * 24 * 60 * 60 * 1000;

    let sinceEpochMs;
    if (ignoreWatermark) {
      sinceEpochMs = defaultSince;
    } else if (lastScanMs && !isNaN(lastScanMs)) {
      if (lastScanMs >= nowMs || lastScanReadCount === 0) {
        // Reset stale watermark
        sinceEpochMs = defaultSince;
      } else {
        sinceEpochMs = lastScanMs - 24 * 60 * 60 * 1000;
      }
    } else {
      sinceEpochMs = defaultSince;
    }

    let currentSince = sinceEpochMs;
    let newestProcessedDate = null;

    const aggregatedSummary = {
      scanned: 0,
      skippedSender: 0,
      duplicateMessage: 0,
      ignored: 0,
      unknown: 0,
      unparsed: 0,
      held: 0,
      created: 0,
      duplicateTransaction: 0,
      skippedDeleted: 0,
      refundLinked: 0,
      possibleDuplicates: 0,
      allowedCount: 0,
      stopReason: null,
      byKind: {
        spend: 0,
        transfer: 0,
        income: 0,
        fixed: 0,
      },
      newestMessageDate: null,
    };

    // 3. Batch loop (limit 500)
    while (true) {
      const batch = await readSms({ sinceEpochMs: currentSince, limit: 500 });
      const messages = Array.isArray(batch) ? batch : [];
      if (messages.length === 0) break;

      // Rebuild state and context per batch
      const state = typeof getState === 'function' ? await getState() : {};
      let ownerNames = [];
      if (db && typeof db.query === 'function') {
        try {
          const rows = await db.query('SELECT value FROM settings WHERE key = ?;', [
            'owner_names',
          ]);
          if (rows[0]?.value) {
            ownerNames = JSON.parse(rows[0].value);
          }
        } catch {}
      }
      if (ownerNames.length === 0 && Array.isArray(state?.ownerNames)) {
        ownerNames = state.ownerNames;
      }

      const ctx = {
        accounts: state.accounts || {},
        brands: state.brands || {},
        rules: state.rules || {},
        ownerNames,
      };

      const seenHashes = new Set();
      if (db && typeof db.query === 'function') {
        const rawRows = await db.query('SELECT hash FROM raw_messages;');
        for (const r of rawRows) seenHashes.add(r.hash);
      }

      const plan = planImport({
        messages,
        ctx,
        state,
        seenHashes,
        allowlist,
        now: nowMs,
      });

      await applyImport({ plan, writer, db });

      // Aggregate counters
      aggregatedSummary.scanned += plan.summary.scanned;
      if (typeof onProgress === 'function') {
        try {
          onProgress({ scanned: aggregatedSummary.scanned });
        } catch {}
      }
      aggregatedSummary.skippedSender += plan.summary.skippedSender;
      aggregatedSummary.duplicateMessage += plan.summary.duplicateMessage;
      aggregatedSummary.ignored += plan.summary.ignored;
      aggregatedSummary.unknown += plan.summary.unknown;
      aggregatedSummary.unparsed += plan.summary.unparsed;
      aggregatedSummary.held += plan.summary.held;
      aggregatedSummary.created += plan.summary.created;
      aggregatedSummary.duplicateTransaction += plan.summary.duplicateTransaction;
      aggregatedSummary.skippedDeleted += plan.summary.skippedDeleted;
      aggregatedSummary.refundLinked += plan.summary.refundLinked;
      aggregatedSummary.possibleDuplicates += plan.summary.possibleDuplicates;

      for (const [k, v] of Object.entries(plan.summary.byKind || {})) {
        aggregatedSummary.byKind[k] = (aggregatedSummary.byKind[k] || 0) + v;
      }

      if (plan.summary.newestMessageDate) {
        newestProcessedDate = Math.max(
          newestProcessedDate || 0,
          plan.summary.newestMessageDate
        );
        aggregatedSummary.newestMessageDate = newestProcessedDate;
      }

      const lastMsgDate = messages[messages.length - 1]?.date;
      if (lastMsgDate) {
        currentSince = lastMsgDate;
      }

      if (messages.length < 500) {
        break;
      }
    }

    const allowedCount = aggregatedSummary.scanned - aggregatedSummary.skippedSender;
    aggregatedSummary.allowedCount = allowedCount;

    if (aggregatedSummary.scanned === 0) {
      aggregatedSummary.stopReason = `no messages received in the last ${days} days`;
    } else if (allowedCount === 0) {
      aggregatedSummary.stopReason = `no messages in the last ${days} days from the allowed senders`;
    } else {
      aggregatedSummary.stopReason = 'reached watermark';
    }

    if (db && typeof db.exec === 'function') {
      await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
        'sms_last_scan_read_count',
        String(aggregatedSummary.scanned),
      ]);
      if (newestProcessedDate) {
        await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
          'sms_last_scan_ms',
          String(newestProcessedDate),
        ]);
      }
    }

    return aggregatedSummary;
  } catch (err) {
    if (err) {
      err.userMessage = mapPermissionError(err);
    }
    throw err;
  } finally {
    isScanRunning = false;
  }
}

