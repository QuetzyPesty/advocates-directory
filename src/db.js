// Thin wrapper over Node's built-in SQLite. No external dependencies.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'db', 'directory.sqlite');

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params).map(plain);
}

export function one(sql, params = []) {
  const row = getDb().prepare(sql).get(...params);
  return row ? plain(row) : null;
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

// node:sqlite returns null-prototype objects; normalise them for JSON.stringify
// and for `in` checks in the view layer.
function plain(row) {
  return { ...row };
}

/** Look up an id by slug, throwing a useful error rather than a null FK. */
export function idBySlug(table, slug) {
  if (slug == null) return null;
  const row = one(`SELECT id FROM ${table} WHERE slug = ?`, [slug]);
  if (!row) throw new Error(`No ${table} with slug "${slug}"`);
  return row.id;
}
