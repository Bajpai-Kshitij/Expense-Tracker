import { listFiles, readFile, appendLine, writeFile } from './expenseNative.js';

/**
 * Creates a storage interface adapter bound to a specific SAF folder URI.
 * Implements { listFiles(prefix), readFile(name), appendLine(name, line), writeFile(name, text) }.
 * 
 * @param {string} folderUri - SAF folder tree URI.
 * @returns {object} Storage adapter.
 */
export function createSyncStorage(folderUri) {
  if (!folderUri || typeof folderUri !== 'string') {
    throw new TypeError('folderUri must be a non-empty string');
  }

  return {
    async listFiles(prefix = '') {
      const files = await listFiles({ uri: folderUri, prefix });
      return files.map((f) => ({
        name: f.name,
        size: f.size,
        lastModified: f.lastModified,
      }));
    },

    async readFile(name) {
      try {
        const res = await readFile({ uri: folderUri, name });
        return res?.text ?? null;
      } catch (err) {
        if (
          err?.code === 'NOT_FOUND' ||
          (err?.message && err.message.toLowerCase().includes('not found'))
        ) {
          return null;
        }
        throw err;
      }
    },

    async appendLine(name, line) {
      return appendLine({ uri: folderUri, name, line });
    },

    async writeFile(name, text) {
      return writeFile({ uri: folderUri, name, text });
    },
  };
}

