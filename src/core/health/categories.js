import { SEED_CATEGORIES } from '../seed/seed.js';
import { createEmptyState, applyEvents } from '../events/reducer.js';
import { parseLine, compareEvents } from '../events/event.js';

/**
 * Resolves a human-readable label for a category ID.
 * - Returns "Uncategorized" ONLY when id is null, undefined, or empty string.
 * - Returns "<Name> (archived)" if the category exists but is archived.
 * - Returns "<Name>" if active.
 * - Returns "Unknown category" if id is non-null but not found in categories.
 * 
 * @param {string|null|undefined} id - Category ID
 * @param {Array<object>|object} categories - Categories list or map
 * @returns {string} Formatted category label
 */
export function categoryLabel(id, categories) {
  if (id === null || id === undefined || id === '') {
    return 'Uncategorized';
  }

  let cat = null;
  if (Array.isArray(categories)) {
    cat = categories.find((c) => c && (c.id === id || c.categoryId === id));
  } else if (categories && typeof categories === 'object') {
    cat = categories[id] || Object.values(categories).find((c) => c && (c.id === id || c.categoryId === id));
  }

  if (!cat) {
    return 'Unknown category';
  }

  const name = cat.name || 'Unknown category';
  if (cat.archived === true || cat.archived === 1 || cat.archived === '1') {
    return `${name} (archived)`;
  }

  return name;
}

/**
 * Builds a complete category object ensuring all required fields are populated.
 * If any core field (name, icon, color) is missing, falls back to SEED_CATEGORIES default.
 * 
 * @param {object} cat - Category input object
 * @param {Array<object>} [seedCategories=SEED_CATEGORIES]
 * @returns {object} Full category object
 */
export function buildFullCategory(cat = {}, seedCategories = SEED_CATEGORIES) {
  const id = cat.id || cat.categoryId;
  const seed = seedCategories.find((s) => s.id === id);

  return {
    id,
    name: cat.name || seed?.name || 'Unnamed Category',
    icon: cat.icon || seed?.icon || '🏷️',
    color: cat.color || seed?.color || '#3b82f6',
    archived: Boolean(cat.archived),
  };
}

/**
 * Restores default seed categories if missing or archived.
 * - For every seed category id that is missing or archived:
 *   writes category.upserted with the seed name, icon, color, archived: false, and a fresh ts.
 * - Never touches active categories.
 * - Idempotent.
 * 
 * @param {object} params
 * @param {object} params.writer - LogWriter instance
 * @param {object} [params.db] - SQLite database adapter
 * @param {Array<object>|object} [params.categories] - Current categories list or map
 * @param {Array<object>} [params.seedCategories=SEED_CATEGORIES]
 * @returns {Promise<{ restoredCount: number, restoredIds: string[] }>}
 */
export async function restoreDefaultCategories({
  writer,
  db,
  categories,
  seedCategories = SEED_CATEGORIES,
}) {
  let catList = [];
  if (Array.isArray(categories)) {
    catList = categories;
  } else if (categories && typeof categories === 'object') {
    catList = Object.values(categories);
  } else if (db && typeof db.query === 'function') {
    const rows = await db.query('SELECT * FROM categories;');
    catList = rows.map((r) => (r.extras ? { ...JSON.parse(r.extras), id: r.id } : r));
  }

  const catMap = new Map();
  for (const c of catList) {
    if (c?.id) catMap.set(c.id, c);
  }

  const toRestore = [];
  for (const seed of seedCategories) {
    const existing = catMap.get(seed.id);
    const isArchived = existing && (existing.archived === true || existing.archived === 1 || existing.archived === '1');
    if (!existing || isArchived) {
      toRestore.push({
        id: seed.id,
        name: seed.name,
        icon: seed.icon,
        color: seed.color,
        archived: false,
      });
    }
  }

  if (toRestore.length === 0) {
    return { restoredCount: 0, restoredIds: [] };
  }

  const restoredIds = [];
  for (const cat of toRestore) {
    if (writer && typeof writer.write === 'function') {
      await writer.write('category.upserted', cat);
    }
    restoredIds.push(cat.id);
  }

  return {
    restoredCount: restoredIds.length,
    restoredIds,
  };
}

/**
 * Collects all category.upserted events from shared storage.
 * 
 * @param {object} storage - SyncStorage interface with listFiles and readFile
 * @returns {Promise<Array<object>>} All parsed events
 */
export async function readAllSharedEvents(storage) {
  if (!storage || typeof storage.listFiles !== 'function') return [];
  const files = await storage.listFiles('events-');
  const eventFiles = (files || []).filter(
    (f) => f && f.name && f.name.startsWith('events-') && f.name.endsWith('.jsonl')
  );

  const allEvents = [];
  for (const f of eventFiles) {
    try {
      const content = await storage.readFile(f.name);
      if (content) {
        const lines = content.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseLine(line.endsWith('\n') ? line : line + '\n');
          if (parsed.ok && parsed.event) {
            allEvents.push(parsed.event);
          }
        }
      }
    } catch {}
  }

  allEvents.sort(compareEvents);
  return allEvents;
}

/**
 * Diagnostics Action (1): Categories dump
 * Every category in the in-memory state with id, name, archived flag, and ts and device of its last event.
 */
export function getCategoriesDump(categories = [], events = []) {
  const catList = Array.isArray(categories) ? categories : Object.values(categories || {});
  const catEvents = events.filter((e) => e && e.type === 'category.upserted');

  // Map last event per category
  const lastEventMap = new Map();
  for (const e of catEvents) {
    const id = e.data?.id || e.data?.categoryId;
    if (id) {
      lastEventMap.set(id, e);
    }
  }

  return catList.map((c) => {
    const id = c.id || c.categoryId;
    const last = lastEventMap.get(id);
    return {
      id,
      name: c.name || '(unnamed)',
      archived: Boolean(c.archived),
      lastTs: last?.ts || null,
      lastDev: last?.dev || null,
    };
  });
}

/**
 * Diagnostics Action (2): Categories recomputed from logs
 * The category list recomputed in memory from ALL events in the shared folder.
 */
export function getCategoriesDumpFromLogs(events = []) {
  const state = applyEvents(createEmptyState(), events);
  const recomputed = Object.values(state.categories || {});
  return getCategoriesDump(recomputed, events);
}

/**
 * Diagnostics Action (3): Category event counts
 * Per category id, the number of category.upserted events and the archived value of the last one.
 */
export function getCategoryEventCounts(events = []) {
  const counts = new Map(); // id -> { id, count, lastArchived, lastTs, lastDev }

  for (const e of events) {
    if (e && e.type === 'category.upserted') {
      const id = e.data?.id || e.data?.categoryId;
      if (id) {
        if (!counts.has(id)) {
          counts.set(id, {
            id,
            count: 0,
            lastArchived: false,
            lastTs: null,
            lastDev: null,
          });
        }
        const record = counts.get(id);
        record.count++;
        record.lastArchived = Boolean(e.data?.archived);
        record.lastTs = e.ts;
        record.lastDev = e.dev;
      }
    }
  }

  return Array.from(counts.values()).sort((a, b) => a.id.localeCompare(b.id));
}
