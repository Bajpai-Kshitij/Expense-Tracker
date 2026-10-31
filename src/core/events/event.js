import { canonicalJson } from './canonical.js';
import { calculateEventCrc } from './crc32.js';
import { generateEventId } from './id.js';

/**
 * Creates an event object with computed CRC.
 * Injects clock and random generator so tests can be fully deterministic.
 * 
 * @param {object} params
 * @param {string} params.type - Event type (e.g. 'expense.created').
 * @param {object} [params.data={}] - Event payload.
 * @param {string} params.dev - Device ID.
 * @param {number} params.seq - Device sequence number.
 * @param {string} [params.ts] - ISO timestamp. If omitted, generated from clock.
 * @param {string} [params.id] - Event ID. If omitted, generated with sortable time + random.
 * @param {() => number} [params.clock] - Clock function returning epoch ms.
 * @param {() => number} [params.now] - Alias for clock.
 * @param {() => number} [params.random] - Random number generator.
 * @param {object} [options={}] - Alternative options container for clock/random.
 * @returns {object} Event object with `v`, `id`, `dev`, `seq`, `ts`, `type`, `crc`, `data`.
 */
export function createEvent(params, options = {}) {
  if (!params || typeof params !== 'object') {
    throw new TypeError('Event parameters must be an object');
  }

  const clock = params.clock || options.clock || params.now || options.now || (() => Date.now());
  const random = params.random || options.random || (() => Math.random());

  const eventTimeMs = params.ts
    ? (typeof params.ts === 'number' ? params.ts : Date.parse(params.ts))
    : clock();

  const ts = params.ts
    ? (typeof params.ts === 'string' ? params.ts : new Date(params.ts).toISOString())
    : new Date(eventTimeMs).toISOString();

  const id = params.id || generateEventId(eventTimeMs, random);
  const data = params.data !== undefined ? params.data : {};

  const eventWithoutCrc = {
    v: 1,
    id,
    dev: params.dev,
    seq: params.seq,
    ts,
    type: params.type,
    data,
  };

  const crc = calculateEventCrc(eventWithoutCrc);

  return {
    ...eventWithoutCrc,
    crc,
  };
}

/**
 * Compares two events deterministically and totally.
 * Ordering: (ts as epoch ms, then dev string, then seq number, then event id).
 * 
 * @param {object} a - First event.
 * @param {object} b - Second event.
 * @returns {number} Negative if a < b, positive if a > b, 0 if identical.
 */
export function compareEvents(a, b) {
  const tsA = typeof a.ts === 'number' ? a.ts : Date.parse(a.ts);
  const tsB = typeof b.ts === 'number' ? b.ts : Date.parse(b.ts);

  if (tsA !== tsB) {
    return tsA - tsB;
  }

  if (a.dev !== b.dev) {
    return a.dev < b.dev ? -1 : 1;
  }

  if (a.seq !== b.seq) {
    return a.seq - b.seq;
  }

  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }

  return 0;
}

/**
 * Serializes an event to a canonical JSON string ending in a newline ("\n").
 * 
 * @param {object} event - Event to serialize.
 * @returns {string} Serialized line with trailing \n.
 */
export function serializeEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('Event to serialize must be an object');
  }

  let eventToSerialize = event;
  if (!event.crc) {
    const crc = calculateEventCrc(event);
    eventToSerialize = { ...event, crc };
  }

  return canonicalJson(eventToSerialize) + '\n';
}

/**
 * Parses and verifies a single line from an event log.
 * Never throws on bad CRC, malformed JSON, or missing newline.
 * 
 * @param {string} line - Raw line from event log.
 * @returns {{ ok: true, event: object } | { ok: false, reason: string }}
 */
export function parseLine(line) {
  try {
    if (typeof line !== 'string') {
      return { ok: false, reason: 'Line must be a string' };
    }

    if (!line.endsWith('\n')) {
      return { ok: false, reason: 'Missing trailing newline' };
    }

    const trimmed = line.slice(0, -1);
    if (trimmed.length === 0) {
      return { ok: false, reason: 'Empty line' };
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      return { ok: false, reason: `Invalid JSON: ${err.message}` };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'Event must be a JSON object' };
    }

    if (parsed.v !== 1) {
      return { ok: false, reason: `Unsupported event version: ${parsed.v}` };
    }

    if (typeof parsed.crc !== 'string') {
      return { ok: false, reason: 'Missing or invalid crc field' };
    }

    const expectedCrc = calculateEventCrc(parsed);
    if (parsed.crc.toLowerCase() !== expectedCrc.toLowerCase()) {
      return {
        ok: false,
        reason: `CRC mismatch: expected ${expectedCrc}, got ${parsed.crc}`,
      };
    }

    return { ok: true, event: parsed };
  } catch (err) {
    return { ok: false, reason: `Unexpected error: ${err.message}` };
  }
}

