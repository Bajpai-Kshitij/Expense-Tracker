/**
 * In-memory storage fake for sync testing.
 * Simulates filesystem operations, partial last lines, conflict copies, and file replacements.
 */
export function createMemoryStorage() {
  const files = new Map();

  return {
    async listFiles(prefix = '') {
      const results = [];
      for (const [name, entry] of files.entries()) {
        if (!prefix || name.startsWith(prefix)) {
          results.push({
            name,
            size: new TextEncoder().encode(entry.content).length,
            lastModified: entry.lastModified,
          });
        }
      }
      return results.sort((a, b) => a.name.localeCompare(b.name));
    },

    async readFile(name) {
      if (!files.has(name)) {
        return null;
      }
      return files.get(name).content;
    },

    async appendLine(name, line) {
      const current = files.get(name)?.content || '';
      const updated = current + line;
      const bytes = new TextEncoder().encode(line).length;
      files.set(name, {
        content: updated,
        lastModified: Date.now(),
      });
      return { mode: 'append', bytes };
    },

    async writeFile(name, text) {
      const bytes = new TextEncoder().encode(text).length;
      files.set(name, {
        content: text,
        lastModified: Date.now(),
      });
      return { bytes };
    },

    // Test simulation helpers
    setRawContent(name, content, lastModified = Date.now()) {
      files.set(name, { content, lastModified });
    },

    getRawContent(name) {
      return files.get(name)?.content ?? null;
    },

    deleteFile(name) {
      files.delete(name);
    },
  };
}

