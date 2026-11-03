/**
 * Comparison and percentage change calculations using integer arithmetic.
 */

/**
 * Computes percentage change between current and previous amounts in basis points.
 * 
 * Rules:
 * - Returns null when previousPaise <= 0 or currentPaise < 0 (negative base or meaningless comparison).
 * - bps is an integer rounded half away from zero.
 * - direction: "up" | "down" | "same"
 * - label: "+12%", "-5%", "no change"
 * - Display rounds bps to a whole percent using integer arithmetic.
 * 
 * @param {number} currentPaise
 * @param {number} previousPaise
 * @returns {{ bps: number, direction: 'up'|'down'|'same', label: string } | null}
 */
export function percentChange(currentPaise, previousPaise) {
  if (
    typeof currentPaise !== 'number' ||
    typeof previousPaise !== 'number' ||
    isNaN(currentPaise) ||
    isNaN(previousPaise)
  ) {
    return null;
  }

  // Meaningless comparison if previous is zero or negative, or current is negative
  if (previousPaise <= 0 || currentPaise < 0) {
    return null;
  }

  const diff = currentPaise - previousPaise;
  if (diff === 0) {
    return { bps: 0, direction: 'same', label: 'no change' };
  }

  // Integer math rounding half away from zero for basis points (10000 = 100%)
  const halfPrev = Math.floor(previousPaise / 2);
  const bps =
    diff > 0
      ? Math.trunc((diff * 10000 + halfPrev) / previousPaise)
      : Math.trunc((diff * 10000 - halfPrev) / previousPaise);

  // Round bps to whole percent with integer math
  const percent =
    bps >= 0
      ? Math.trunc((bps + 50) / 100)
      : Math.trunc((bps - 50) / 100);

  if (percent === 0) {
    return { bps, direction: 'same', label: 'no change' };
  }

  const direction = percent > 0 ? 'up' : 'down';
  const label = percent > 0 ? `+${percent}%` : `${percent}%`;

  return { bps, direction, label };
}

