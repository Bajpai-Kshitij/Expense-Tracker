/**
 * Money utilities enforcing integer paise representation.
 * All business logic handles money strictly as integer paise (1 Rupee = 100 paise).
 */

/**
 * Validates that the input is a valid integer paise amount.
 * @param {number} paise 
 * @returns {number} The validated integer paise amount.
 * @throws {TypeError} If the value is not a safe integer.
 */
export function validatePaise(paise) {
  if (typeof paise !== 'number' || !Number.isSafeInteger(paise)) {
    throw new TypeError(`Expected integer paise, received: ${paise} (${typeof paise})`);
  }
  return paise;
}

/**
 * Formats integer paise into a human-readable Indian Rupee string (e.g. ₹12.50).
 * @param {number} paise - Amount in integer paise.
 * @returns {string} Formatted currency string.
 */
export function formatPaise(paise) {
  validatePaise(paise);
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const remainderPaise = absPaise % 100;
  const formattedPaise = remainderPaise.toString().padStart(2, '0');
  const sign = isNegative ? '-' : '';
  return `${sign}₹${rupees}.${formattedPaise}`;
}

/**
 * Converts decimal/numeric rupees into integer paise, rounding to the nearest paise.
 * Avoids floating point representation errors.
 * @param {number|string} rupees - Amount in rupees (e.g. 12.50, "12.50").
 * @returns {number} Integer paise.
 */
export function rupeesToPaise(rupees) {
  const num = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (typeof num !== 'number' || Number.isNaN(num) || !Number.isFinite(num)) {
    throw new TypeError(`Invalid rupees value: ${rupees}`);
  }
  return Math.round(num * 100);
}

/**
 * Converts integer paise into a decimal string representation of rupees.
 * @param {number} paise - Amount in integer paise.
 * @returns {string} Rupee string with 2 decimal places (e.g. "12.50").
 */
export function paiseToRupees(paise) {
  validatePaise(paise);
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const remainderPaise = absPaise % 100;
  const sign = isNegative ? '-' : '';
  return `${sign}${rupees}.${remainderPaise.toString().padStart(2, '0')}`;
}

/**
 * Adds two integer paise amounts.
 * @param {number} a - First amount in integer paise.
 * @param {number} b - Second amount in integer paise.
 * @returns {number} Sum in integer paise.
 */
export function addPaise(a, b) {
  validatePaise(a);
  validatePaise(b);
  return a + b;
}

/**
 * Subtracts one integer paise amount from another.
 * @param {number} a - Amount to subtract from (in integer paise).
 * @param {number} b - Amount to subtract (in integer paise).
 * @returns {number} Difference in integer paise.
 */
export function subtractPaise(a, b) {
  validatePaise(a);
  validatePaise(b);
  return a - b;
}

