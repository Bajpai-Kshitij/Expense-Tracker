/**
 * Native bridge interfaces for Capacitor custom plugins and device capabilities.
 * 
 * In subsequent phases, this module exposes:
 * - SMS Reader Plugin (read incoming SMS transactions)
 * - SAF Storage Plugin (Storage Access Framework for shared folder read/write)
 * - SQLite Database Plugin (@capacitor-community/sqlite)
 */

export const NATIVE_CAPABILITIES = {
  SMS_READER: 'SmsReader',
  SAF_STORAGE: 'SafStorage',
  SQLITE: 'CapacitorSQLite',
};

/**
 * Checks if the application is currently running in a native Capacitor environment.
 * @returns {boolean} True if running on Android/iOS native container, false in web browser.
 */
export function isNativePlatform() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

/**
 * Returns the active platform identifier ('android', 'ios', or 'web').
 * @returns {string} Platform name.
 */
export function getPlatform() {
  if (typeof window === 'undefined') return 'node';
  return window.Capacitor?.getPlatform?.() || 'web';
}

