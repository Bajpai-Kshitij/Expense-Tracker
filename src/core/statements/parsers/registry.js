const registeredParsers = [];

/**
 * Registers a statement parser implementation.
 *
 * @param {object} parser
 * @param {string} parser.issuer - Issuer identifier
 * @param {(lines: Array<{page: number, lineNo: number, text: string}>) => boolean} parser.detect
 * @param {(lines: Array<{page: number, lineNo: number, text: string}>, ctx?: object) => object} parser.parse
 */
export function registerStatementParser(parser) {
  if (!parser || typeof parser.detect !== 'function' || typeof parser.parse !== 'function') {
    throw new TypeError('Statement parser must implement detect(lines) and parse(lines, ctx)');
  }
  registeredParsers.push(parser);
}

/**
 * Clears all registered parsers (useful for test isolation).
 */
export function clearParsers() {
  registeredParsers.length = 0;
}

/**
 * Parses lines with the first matching registered statement parser.
 * Picks the first parser whose detect returns true, never throws.
 *
 * @param {Array<{page: number, lineNo: number, text: string}>} lines
 * @param {object} [ctx={}]
 * @returns {object} Parser result or failure object { ok: false, reason }
 */
export function parseStatement(lines, ctx = {}) {
  try {
    if (!Array.isArray(lines) || lines.length === 0) {
      return { ok: false, reason: 'no_parser' };
    }

    for (const parser of registeredParsers) {
      let detected = false;
      try {
        detected = parser.detect(lines);
      } catch {
        detected = false;
      }

      if (detected) {
        const result = parser.parse(lines, ctx);
        return {
          ok: true,
          issuer: result.issuer || parser.issuer,
          account: result.account || {},
          period: result.period || null,
          lines: result.lines || [],
          declaredTotals: result.declaredTotals || null,
          warnings: result.warnings || [],
          unparsedLines: result.unparsedLines || [],
        };
      }
    }

    return { ok: false, reason: 'no_parser' };
  } catch (err) {
    return { ok: false, reason: err?.message || 'error' };
  }
}

