import { createEvent, serializeEvent, parseLine } from '../events/index.js';
import { applyEventsToDb } from '../db/index.js';

/**
 * Formats epoch ms into an ISO-8601 string with Indian Standard Time (+05:30) offset.
 * 
 * @param {number} epochMs - Epoch timestamp in milliseconds.
 * @returns {string} Formatted timestamp: YYYY-MM-DDTHH:mm:ss.sss+05:30.
 */
export function formatIsoIst(epochMs) {
  const d = new Date(epochMs + 19800000); // 19,800,000 ms = +05:30
  const YYYY = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const sss = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${YYYY}-${MM}-${DD}T${HH}:${mm}:${ss}.${sss}+05:30`;
}

function parseNowMs(now) {
  if (typeof now === 'function') {
    const res = now();
    return typeof res === 'number'
      ? res
      : (typeof res === 'string' ? Date.parse(res) : res.getTime());
  }
  if (typeof now === 'number') return now;
  if (typeof now === 'string') return Date.parse(now);
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

/**
 * Creates an append-only event log writer for the specified device.
 * Maintains monotonic sequence numbers and timestamps.
 * 
 * @param {object} options
 * @param {string} options.deviceId - Unique identifier for this device.
 * @param {object} options.storage - Shared storage interface { readFile, appendLine, writeFile }.
 * @param {object} [options.db] - SQLite database adapter.
 * @param {() => number|string|Date} [options.now=() => Date.now()] - Timestamp clock generator.
 * @param {() => number} [options.random=Math.random] - Random number generator.
 * @returns {object} Writer instance with `write`, `writeMany`, `getSeq`, `getLastTs`, and `init`.
 */
export function createWriter({
  deviceId,
  storage,
  db,
  now = () => Date.now(),
  random = Math.random,
}) {
  const fileName = `events-${deviceId}.jsonl`;
  let seq = null;
  let lastTsMs = 0;
  let initPromise = null;

  async function ensureInit() {
    if (seq !== null) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      let maxSeq = 0;
      let maxTs = 0;

      if (storage && typeof storage.readFile === 'function') {
        const content = await storage.readFile(fileName);
        if (content) {
          const lines = content.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const fullLine = line.endsWith('\n') ? line : line + '\n';
            const parsed = parseLine(fullLine);
            if (parsed.ok && parsed.event) {
              if (typeof parsed.event.seq === 'number' && parsed.event.seq > maxSeq) {
                maxSeq = parsed.event.seq;
              }
              if (parsed.event.ts) {
                const ms = typeof parsed.event.ts === 'number'
                  ? parsed.event.ts
                  : Date.parse(parsed.event.ts);
                if (!isNaN(ms) && ms > maxTs) {
                  maxTs = ms;
                }
              }
            }
          }
        }
      }

      seq = maxSeq + 1;
      lastTsMs = maxTs;
    })();

    return initPromise;
  }

  return {
    async init() {
      await ensureInit();
      return { seq, lastTsMs };
    },

    getSeq() {
      return seq;
    },

    getLastTs() {
      return lastTsMs;
    },

    /**
     * Appends an event to the device log and applies it to the local read model.
     * 
     * @param {string} type - Event type (e.g. 'expense.created').
     * @param {object} data - Event payload.
     * @returns {Promise<object>} Created event object.
     */
    async write(type, data = {}) {
      await ensureInit();

      const nowMs = parseNowMs(now);
      const currentTsMs = Math.max(nowMs, lastTsMs);
      lastTsMs = currentTsMs;
      const ts = formatIsoIst(currentTsMs);
      const currentSeq = seq++;

      const event = createEvent({
        type,
        data,
        dev: deviceId,
        seq: currentSeq,
        ts,
        random,
      });

      const line = serializeEvent(event);
      await storage.appendLine(fileName, line);

      if (db) {
        try {
          const parsedEvent = JSON.parse(line.trim());
          await applyEventsToDb(db, [parsedEvent]);
        } catch (err) {
          throw new Error(`Database apply failed for event ${event.id}: ${err.message}`);
        }
      }

      return event;
    },

    /**
     * Appends multiple events to the device log in one batch.
     * 
     * @param {Array<{ type: string, data: object }>} list - Array of events to append.
     * @returns {Promise<object[]>} Array of created event objects.
     */
    async writeMany(list = []) {
      if (list.length === 0) return [];
      await ensureInit();

      const events = [];
      const lines = [];

      for (const item of list) {
        const nowMs = parseNowMs(now);
        const currentTsMs = Math.max(nowMs, lastTsMs);
        lastTsMs = currentTsMs;
        const ts = formatIsoIst(currentTsMs);
        const currentSeq = seq++;

        const event = createEvent({
          type: item.type,
          data: item.data || {},
          dev: deviceId,
          seq: currentSeq,
          ts,
          random,
        });

        const line = serializeEvent(event);
        events.push(event);
        lines.push(line);
      }

      const combinedLines = lines.join('');
      if (typeof storage.appendLines === 'function') {
        await storage.appendLines(fileName, combinedLines);
      } else {
        await storage.appendLine(fileName, combinedLines);
      }

      if (db) {
        try {
          const parsedEvents = lines.map((l) => JSON.parse(l.trim()));
          await applyEventsToDb(db, parsedEvents);
        } catch (err) {
          throw new Error(`Database apply failed for batch write: ${err.message}`);
        }
      }

      return events;
    },
  };
}
