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
  // Datasets live in data/. data/private/ holds the ones that are deliberately
  // not committed — contact details off the AoR roll, the personal alumni list
  // — so that a public repository does not republish them. Their absence in a
  // clone is normal, not an error.
  const dir = path.join(ROOT, 'data');
  const privateDir = path.join(dir, 'private');
  const jsonIn = d => fs.existsSync(d)
    ? fs.readdirSync(d).filter(f => f.endsWith('.json') && f !== 'import-template.json')
        .map(f => path.join(d, f))
    : [];

  // Load order follows what a file IS, not where it sits. A dataset owns the
  // people it names and replaces their child rows; an overlay carries a
  // fragment and must run after every owner has had its final say, or the
  // owner's next pass wipes it straight back out. Sorting datasets by basename
  // keeps that order stable no matter which directory a file lives in — moving
  // nls-alumni.json into data/private/ must not let it clobber the richer
  // records that sc-advocates.json owns for the same people.
  const all = [...jsonIn(dir), ...jsonIn(privateDir)];
  const isOverlay = f => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8'))._merge === true; }
    catch { return false; }
  };
  const byName = (a, b) => path.basename(a).localeCompare(path.basename(b));
  const datasets = all.filter(f => !isOverlay(f)).sort(byName);
  const overlays = all.filter(isOverlay).sort(byName);

  if (!datasets.length) console.log('no datasets in data/ — database is empty');
  const load = f => execFileSync(process.execPath,
    [path.join(ROOT, 'scripts', 'import-json.js'), f], { stdio: 'inherit' });

  for (const f of datasets) load(f);

  // Second pass. A relationship whose other endpoint lives in a file that had
  // not been loaded yet is skipped, so datasets that reference each other only
  // resolve one way on a single pass. The import is idempotent, so replaying it
  // once everyone exists is free and picks up the cross-file edges.
  if (datasets.length > 1) {
    console.log(`\nSecond pass — resolving relationships that cross datasets:`);
    for (const f of datasets) load(f);
  }

  if (overlays.length) {
    console.log(`\nOverlays:`);
    for (const f of overlays) load(f);
  }
}

const check = new DatabaseSync(DB_PATH);
const counts = ['person', 'organisation', 'relationship', 'practice_area', 'court', 'institution']
  .map(t => `${t}=${check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`)
  .join('  ');
check.close();

console.log(`\nDatabase ready at ${path.relative(process.cwd(), DB_PATH)}`);
console.log(counts);
