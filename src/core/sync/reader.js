import { parseLine } from '../events/index.js';

function extractCompleteLines(content) {
  if (!content) return [];
  const rawLines = content.split('\n');
  rawLines.pop();
  return rawLines.map((l) => l + '\n');
}

async function getFileLinesRead(syncState, db, fileName) {
  if (!syncState && !db) return 0;

  if (typeof syncState?.getSyncState === 'function') {
    if (db) {
      try {
        const val = await syncState.getSyncState(db, fileName);
        if (typeof val === 'number') return val;
      } catch (e) {
        // Fall back to 1-arg call
      }
    }
    try {
      const val = await syncState.getSyncState(fileName);
      if (typeof val === 'number') return val;
    } catch (e) {
      // Ignore
    }
  }

  if (syncState instanceof Map) {
    return syncState.get(fileName) || 0;
  }

  if (db && typeof db.query === 'function') {
    try {
      const rows = await db.query('SELECT lines_read FROM sync_state WHERE file = ?;', [fileName]);
      return rows[0]?.lines_read ?? 0;
    } catch (e) {
      return 0;
    }
  }

  return 0;
}

/**
 * Reads all event log files matching events-*.jsonl from shared storage.
 * Handles incremental syncing, partial last lines, conflict copies, and corrupted lines.
 * 
 * @param {object} options
 * @param {object} options.storage - Shared storage interface.
 * @param {object} [options.syncState] - Sync state tracking interface.
 * @param {object} [options.db] - SQLite database adapter.
 * @param {boolean} [options.full=false] - When true, re-reads all files from line 0.
 * @returns {Promise<{ events: object[], issues: object[], fileStats: object[], totalLinesRead: number }>}
 */
export async function readAllEvents({
  storage,
  syncState,
  db,
  full = false,
} = {}) {
  const issues = [];
  const events = [];
  const fileStats = [];
  let totalLinesRead = 0;

  if (!storage || typeof storage.listFiles !== 'function') {
    return { events, issues, fileStats, totalLinesRead };
  }

  const allFiles = await storage.listFiles('events-');
  const eventFiles = (allFiles || [])
    .filter((f) => f && f.name && f.name.startsWith('events-') && f.name.endsWith('.jsonl'))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const file of eventFiles) {
    const isConflictCopy = /\(\d+\)\.jsonl$/.test(file.name) || file.name.includes(' (');
    if (isConflictCopy) {
      issues.push({
        file: file.name,
        type: 'warning',
        reason: `Conflict copy detected: ${file.name}`,
      });
    }

    const content = await storage.readFile(file.name);
    const completeLines = extractCompleteLines(content);
    const totalCompleteCount = completeLines.length;

    let linesReadBefore = 0;
    if (!full) {
      linesReadBefore = await getFileLinesRead(syncState, db, file.name);
      if (totalCompleteCount < linesReadBefore) {
        // File was replaced by an older or shorter version; re-read from line 0
        linesReadBefore = 0;
      }
    }

    const startIndex = linesReadBefore;
    const newLinesRead = totalCompleteCount - startIndex;
    totalLinesRead += newLinesRead;

    fileStats.push({
      name: file.name,
      linesCount: totalCompleteCount,
      newLinesRead,
    });

    for (let i = startIndex; i < totalCompleteCount; i++) {
      const line = completeLines[i];
      const parsed = parseLine(line);

      if (!parsed.ok) {
        issues.push({
          file: file.name,
          lineNo: i + 1,
          reason: parsed.reason,
        });
      } else {
        events.push(parsed.event);
      }
    }
  }

  return {
    events,
    issues,
    fileStats,
    totalLinesRead,
  };
}

