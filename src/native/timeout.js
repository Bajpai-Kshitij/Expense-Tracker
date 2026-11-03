/**
 * Timeout helper for asynchronous native and runtime operations.
 * 
 * @template T
 * @param {Promise<T>} promise - The promise to await.
 * @param {number} ms - Timeout duration in milliseconds.
 * @param {string} label - Step name used in error if timed out.
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`Timeout during step: ${label}`));
    }, ms);
  });

  return Promise.race([
    Promise.resolve(promise),
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timerId);
  });
}

