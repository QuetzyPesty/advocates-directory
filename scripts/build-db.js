#!/usr/bin/env node
// Rebuild the database from scratch: schema, taxonomy, then the sample import.
//
//   node scripts/build-db.js            # rebuild + load every data/*.json
//   node scripts/build-db.js --empty    # schema and taxonomy only
//
// Destructive: deletes db/directory.sqlite.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, DB_PATH } from '../src/db.js';

const empty = process.argv.includes('--empty');

for (const suffix of ['', '-wal', '-shm']) {
  const f = DB_PATH + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

for (const file of ['01-schema.sql', '02-taxonomy.sql']) {
  const sql = fs.readFileSync(path.join(ROOT, 'db', file), 'utf8');
  db.exec(sql);
  console.log(`applied db/${file}`);
}
db.close();

if (!empty) {
  // Load every dataset in data/, skipping the blank template.
  const dir = path.join(ROOT, 'data');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'import-template.json').sort()
        .map(f => path.join(dir, f))
    : [];
  // data/private/ holds overlays that are deliberately not committed — contact
  // details off the AoR roll, for one. They are part of a local build and
  // absent from a clone, so their absence is normal, not an error.
  const privateDir = path.join(dir, 'private');
  const privateFiles = fs.existsSync(privateDir)
    ? fs.readdirSync(privateDir).filter(f => f.endsWith('.json')).sort()
        .map(f => path.join(privateDir, f))
    : [];
  if (!files.length) console.log('no datasets in data/ — database is empty');
  const load = f => execFileSync(process.execPath,
    [path.join(ROOT, 'scripts', 'import-json.js'), f], { stdio: 'inherit' });

  for (const f of files) load(f);

  // Second pass. A relationship whose other endpoint lives in a file that had
  // not been loaded yet is skipped, so datasets that reference each other only
  // resolve one way on a single pass. The import is idempotent, so replaying it
  // once everyone exists is free and picks up the cross-file edges.
  if (files.length > 1) {
    console.log(`\nSecond pass — resolving relationships that cross datasets:`);
    for (const f of files) load(f);
  }

  // Overlays go last, after every owning file has had its final say. A normal
  // import replaces the child rows it owns, so loading these earlier would let
  // the second pass wipe them straight back out.
  if (privateFiles.length) {
    console.log(`\nLocal-only overlays (data/private/, not committed):`);
    for (const f of privateFiles) load(f);
  }
}

const check = new DatabaseSync(DB_PATH);
const counts = ['person', 'organisation', 'relationship', 'practice_area', 'court', 'institution']
  .map(t => `${t}=${check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`)
  .join('  ');
check.close();

console.log(`\nDatabase ready at ${path.relative(process.cwd(), DB_PATH)}`);
console.log(counts);
