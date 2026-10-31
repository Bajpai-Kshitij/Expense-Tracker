import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * @typedef {Object} FolderInfo
 * @property {string} uri - SAF tree URI.
 * @property {string} name - Display name of the folder.
 * 
 * @typedef {Object} FolderStatus
 * @property {boolean} ok - True if folder is accessible with read & write permissions.
 * @property {boolean} canRead - True if persistable read permission is active.
 * @property {boolean} canWrite - True if persistable write permission is active.
 * 
 * @typedef {Object} FileInfo
 * @property {string} name - File name.
 * @property {number} size - File size in bytes.
 * @property {number} lastModified - Last modified timestamp in epoch ms.
 * 
 * @typedef {Object} ReadFileResult
 * @property {string} text - UTF-8 contents of the file.
 * 
 * @typedef {Object} AppendLineResult
 * @property {'append'|'rewrite'} mode - Mode used to write the line.
 * @property {number} bytes - Number of bytes appended.
 * 
 * @typedef {Object} WriteFileResult
 * @property {number} bytes - Number of bytes written.
 * 
 * @typedef {Object} SmsMessage
 * @property {string} id - SMS internal ID.
 * @property {string} address - Sender phone number or header.
 * @property {string} body - SMS body text.
 * @property {number} date - Timestamp in epoch ms.
 */

export let ExpenseNative = registerPlugin('ExpenseNative');

/**
 * Sets a custom or mock instance of the native plugin (used for testing).
 * @param {object} plugin - Plugin implementation.
 */
export function setExpenseNativePlugin(plugin) {
  ExpenseNative = plugin;
}

function checkPlatform() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('ExpenseNative is only available on Android');
  }
}

function validateUri(uri) {
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    throw new TypeError('Invalid uri: must be a non-empty string');
  }
}

function validateName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Invalid file name: name must be a non-empty string');
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error("Invalid file name: name must not contain '/', '\\', or '..'");
  }
}

/**
 * Prompts user to pick a folder via Storage Access Framework.
 * Persists read/write URI permission across device reboots.
 * 
 * @returns {Promise<FolderInfo>} Picked folder details.
 */
export async function pickFolder() {
  checkPlatform();
  return ExpenseNative.pickFolder();
}

/**
 * Checks whether persisted permissions for a folder URI remain valid.
 * 
 * @param {object} options
 * @param {string} options.uri - Folder tree URI.
 * @returns {Promise<FolderStatus>} Permission status.
 */
export async function checkFolder(options) {
  checkPlatform();
  if (!options || typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }
  validateUri(options.uri);
  return ExpenseNative.checkFolder({ uri: options.uri });
}

/**
 * Lists non-recursive files inside the picked SAF folder.
 * 
 * @param {object} options
 * @param {string} options.uri - Folder tree URI.
 * @param {string} [options.prefix] - Optional prefix filter.
 * @returns {Promise<FileInfo[]>} Array of file entries.
 */
export async function listFiles(options) {
  checkPlatform();
  if (!options || typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }
  validateUri(options.uri);
  if (options.prefix !== undefined && typeof options.prefix !== 'string') {
    throw new TypeError('Prefix must be a string');
  }
  const result = await ExpenseNative.listFiles({
    uri: options.uri,
    prefix: options.prefix,
  });
  return result?.files || [];
}

/**
 * Reads UTF-8 content from a file inside the picked SAF folder.
 * 
 * @param {object} options
 * @param {string} options.uri - Folder tree URI.
 * @param {string} options.name - File name.
 * @returns {Promise<ReadFileResult>} File content.
 */
export async function readFile(options) {
  checkPlatform();
  if (!options || typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }
  validateUri(options.uri);
  validateName(options.name);
  return ExpenseNative.readFile({
    uri: options.uri,
    name: options.name,
  });
}

/**
 * Appends a line to a file inside the picked SAF folder, creating it if missing.
 * Falls back to rewrite mode if the provider does not support native append.
 * 
 * @param {object} options
 * @param {string} options.uri - Folder tree URI.
 * @param {string} options.name - File name.
 * @param {string} options.line - Line to append (including trailing newline).
 * @returns {Promise<AppendLineResult>} Write mode and byte count.
 */
export async function appendLine(options) {
  checkPlatform();
  if (!options || typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }
  validateUri(options.uri);
  validateName(options.name);
  if (typeof options.line !== 'string') {
    throw new TypeError('Line must be a string');
  }
  return ExpenseNative.appendLine({
    uri: options.uri,
    name: options.name,
    line: options.line,
  });
}

/**
 * Creates or overwrites a file with UTF-8 text inside the picked SAF folder.
 * 
 * @param {object} options
 * @param {string} options.uri - Folder tree URI.
 * @param {string} options.name - File name.
 * @param {string} options.text - Text to write.
 * @returns {Promise<WriteFileResult>} Number of bytes written.
 */
export async function writeFile(options) {
  checkPlatform();
  if (!options || typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }
  validateUri(options.uri);
  validateName(options.name);
  if (typeof options.text !== 'string') {
    throw new TypeError('Text must be a string');
  }
  return ExpenseNative.writeFile({
    uri: options.uri,
    name: options.name,
    text: options.text,
  });
}

/**
 * Reads incoming SMS messages from the device Inbox provider.
 * Requests runtime READ_SMS permission if not already granted.
 * 
 * @param {object} [options={}]
 * @param {number} [options.sinceEpochMs=0] - Only return SMS received after this epoch ms.
 * @param {number} [options.limit=500] - Max messages to retrieve (max 2000).
 * @returns {Promise<SmsMessage[]>} Messages ordered by date ascending.
 */
export async function readSms(options = {}) {
  checkPlatform();
  if (options && typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }
  if (options.sinceEpochMs !== undefined && typeof options.sinceEpochMs !== 'number') {
    throw new TypeError('sinceEpochMs must be a number');
  }
  if (options.limit !== undefined && (typeof options.limit !== 'number' || options.limit < 0)) {
    throw new TypeError('limit must be a positive number');
  }
  const result = await ExpenseNative.readSms({
    sinceEpochMs: options.sinceEpochMs || 0,
    limit: options.limit || 500,
  });
  return result?.sms || [];
}
