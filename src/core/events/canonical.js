/**
 * Canonical JSON serializer.
 * Produces deterministic JSON with stable lexicographical key order and no whitespace.
 */

/**
 * Serializes a JavaScript value to canonical JSON string.
 * - Object keys are sorted lexicographically at every level.
 * - Array element order is preserved.
 * - Primitives are formatted without whitespace.
 * - Undefined values in objects are omitted (like standard JSON.stringify).
 * 
 * @param {*} value - Value to serialize.
 * @returns {string} Canonical JSON representation.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (typeof value.toJSON === 'function') {
    return canonicalJson(value.toJSON());
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }

  const keys = Object.keys(value).sort();
  const entries = [];
  for (const key of keys) {
    const val = value[key];
    if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
      entries.push(JSON.stringify(key) + ':' + canonicalJson(val));
    }
  }

  return '{' + entries.join(',') + '}';
}

