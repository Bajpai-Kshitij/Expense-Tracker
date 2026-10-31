import { canonicalJson } from './canonical.js';

/**
 * Standard IEEE 802.3 CRC32 table precomputed for fast byte processing.
 */
function createCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = createCrcTable();

/**
 * Computes the IEEE 802.3 CRC32 checksum of a string as an 8-character lowercase hex string.
 * @param {string} str - String to hash.
 * @returns {string} 8 lowercase hex characters.
 */
export function crc32(str) {
  const bytes = new TextEncoder().encode(str);
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0').toLowerCase();
}

/**
 * Computes CRC32 of an event's canonical JSON excluding the `crc` property.
 * @param {object} event - Event object.
 * @returns {string} 8 lowercase hex characters.
 */
export function calculateEventCrc(event) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('Event must be an object');
  }
  const { crc: _ignored, ...eventWithoutCrc } = event;
  const canonical = canonicalJson(eventWithoutCrc);
  return crc32(canonical);
}

