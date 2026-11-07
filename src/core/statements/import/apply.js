/**
 * Applies a statement import plan with strict transactional ordering:
 * 1) Append events via writer.writeMany (appends to event log and updates read model).
 * 2) In ONE database transaction: insert raw_messages (IGNORE) and review_queue (IGNORE).
 *
 * @param {object} params
 * @param {object} params.plan - Result of planStatementImport
 * @param {object} params.writer - LogWriter instance
 * @param {object} [params.db] - SQLite database adapter
 */
export async function applyStatementImport({ plan, writer, db }) {
  if (!plan) return;

  // 1) Write events first through writer
  if (plan.events && plan.events.length > 0 && writer && typeof writer.writeMany === 'function') {
    await writer.writeMany(plan.events);
  }

  // 2) ONE database transaction for raw rows and review items
  if (db && typeof db.transaction === 'function') {
    await db.transaction(async (tx) => {
      for (const row of plan.rawRows || []) {
        const receivedAtStr =
          typeof row.received_at === 'number'
            ? new Date(row.received_at).toISOString()
            : String(row.received_at || '');
        await tx.exec(
          'INSERT OR IGNORE INTO raw_messages (hash, kind, body, received_at, parsed) VALUES (?, ?, ?, ?, ?);',
          [row.hash, row.kind, row.body, receivedAtStr, row.parsed]
        );
      }

      for (const item of plan.reviewItems || []) {
        const payloadStr = JSON.stringify(item.payload || item);
        await tx.exec(
          'INSERT OR IGNORE INTO review_queue (id, type, payload, status) VALUES (?, ?, ?, ?);',
          [item.id, item.type, payloadStr, item.status || 'open']
        );
      }
    });
  }
}

