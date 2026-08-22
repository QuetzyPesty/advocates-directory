#!/usr/bin/env node
// ============================================================================
// Turn accumulated cause-list appearances into import JSON.
//
//   npm run derive:causelist
//   npm run derive:causelist -- --min-together=3 --min-opposed=4
//
// Reads every data/cause-lists/*.jsonl and derives two things no profile page
// states:
//
//   1. Court practice, measured.  How many times a person was actually listed,
//      over how many sitting days, before which Benches. `frequency` follows
//      the count rather than an assertion.
//
//   2. Who they appear with.  Two advocates on the same side of the same item
//      are co-counsel; on opposite sides, opposed.
//
// Both are thresholded. One shared listing is a coincidence — two AoRs land in
// the same matter constantly — so an edge is only written once a pair recurs.
// The thresholds are printed and recorded in _review; nothing is silently cut.
//
// What this does NOT claim: seniority, mentorship, or that an advocate argued.
// A cause list records who is ON RECORD for a party on a given day. It does not
// say the matter was reached, or who stood up.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { nameIndex, normaliseName } from './lib/cause-list.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const ROOT = path.resolve(import.meta.dirname, '..');
const IN_DIR = path.resolve(ROOT, opt('in-dir', 'data/cause-lists'));
const OUT = path.resolve(ROOT, opt('out', 'data/cause-list-derived.json'));
const MIN_TOGETHER = Number(opt('min-together', 3));
const MIN_OPPOSED = Number(opt('min-opposed', 4));
const PRIMARY_AT = Number(opt('primary-at', 20));
const REGULAR_AT = Number(opt('regular-at', 5));

if (!fs.existsSync(IN_DIR)) {
  console.error(`No ${path.relative(ROOT, IN_DIR)} yet — run "npm run scrape:causelist" first.`);
  process.exit(1);
}

const files = fs.readdirSync(IN_DIR).filter(f => /\.jsonl(\.gz)?$/.test(f)).sort();
if (!files.length) { console.error(`No .jsonl files in ${path.relative(ROOT, IN_DIR)}.`); process.exit(1); }

const readDay = f => {
  const buf = fs.readFileSync(path.join(IN_DIR, f));
  return (f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
};

const rows = [];
for (const f of files) {
  for (const line of readDay(f).split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* truncated line; skip */ }
  }
}

// Re-resolve names against the CURRENT datasets rather than trusting the slug
// stored when the day was scraped. Slugs are allocated per roll edition, so a
// monthly roll refresh can rename people and silently orphan a year of archive.
// The name is the durable key; the stored slug is only a fallback.
const current = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
  if (!f.endsWith('.json') || f === 'import-template.json') continue;
  try { current.push(...(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')).people || [])); }
  catch { /* not an import file */ }
}
const index = nameIndex(current);
let rebound = 0, orphaned = 0;
for (const r of rows) {
  if (!r.name) continue;
  const hit = index.get(normaliseName(r.name));
  if (hit && hit.length === 1) {
    if (r.slug && r.slug !== hit[0]) rebound++;
    r.slug = hit[0];
  } else if (r.slug && !hit) {
    orphaned++;
    r.slug = null;
  }
}

const review = [];
const note = (k, m) => review.push(`${k}: ${m}`);

const resolved = rows.filter(r => r.slug);
if (rebound || orphaned) note('re-resolved against the current roll',
  `${rebound} appearances now point at a different slug than when they were scraped, and ${orphaned} no longer ` +
  `match anyone — the roll is reissued periodically and slugs move with it. Names are re-resolved on every ` +
  `derivation so the archive repairs itself instead of quietly decaying.`);
const days = [...new Set(rows.map(r => r.date))].sort();
note('window', `${resolved.length} resolved appearances from ${days.length} sitting ${days.length === 1 ? 'day' : 'days'} ` +
  `(${days[0]} to ${days[days.length - 1]}), across ${files.length} daily files.`);
note('unresolved', `${rows.length - resolved.length} appearances named someone not matched to a person in data/ ` +
  `— usually an AoR firm, which files under the firm's name rather than an individual's. They are counted in ` +
  `nothing below.`);
const ambiguous = rows.filter(r => !r.slug && r.candidates?.length).length;
if (ambiguous) note('ambiguous names', `${ambiguous} appearances matched more than one person on the roll and were ` +
  `left unassigned rather than guessed.`);

// --- 1. court practice ------------------------------------------------------

const perPerson = new Map();
for (const r of resolved) {
  if (!perPerson.has(r.slug)) perPerson.set(r.slug, { listings: 0, days: new Set(), benches: new Set(), cases: new Set() });
  const p = perPerson.get(r.slug);
  p.listings++;
  p.days.add(r.date);
  if (r.court) p.benches.add(r.court);
  if (r.case) p.cases.add(r.case);
}

const people = [...perPerson].map(([slug, p]) => ({
  slug,
  courts: [{
    slug: 'supreme-court-of-india',
    frequency: p.listings >= PRIMARY_AT ? 'primary' : p.listings >= REGULAR_AT ? 'regular' : 'occasional',
    note: `Listed in ${p.cases.size} ${p.cases.size === 1 ? 'matter' : 'matters'} across ` +
          `${p.days.size} of ${days.length} cause lists (${days[0]} to ${days[days.length - 1]}), ` +
          `before ${p.benches.size} ${p.benches.size === 1 ? 'Bench' : 'Benches'}.`,
  }],
}));

note('frequency thresholds', `"primary" at ${PRIMARY_AT}+ listings in the window, "regular" at ${REGULAR_AT}+, ` +
  `otherwise "occasional". Over a short window almost everyone is occasional; the labels only mean something ` +
  `once months of lists have accumulated.`);

// --- 2. who appears with whom ----------------------------------------------

const byCase = new Map();
for (const r of resolved) {
  const key = `${r.date}|${r.list}|${r.case}|${r.item}`;
  if (!byCase.has(key)) byCase.set(key, []);
  byCase.get(key).push(r);
}

const together = new Map();   // same side
const against = new Map();    // opposite sides
const bump = (map, a, b, caseKey) => {
  const [x, y] = [a, b].sort();
  const k = `${x}|${y}`;
  if (!map.has(k)) map.set(k, new Set());
  map.get(k).add(caseKey);
};

for (const [key, team] of byCase) {
  const uniq = [...new Map(team.map(t => [t.slug + '|' + t.side, t])).values()];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i], b = uniq[j];
      if (a.slug === b.slug) continue;
      const sideA = a.side, sideB = b.side;
      const both = ['petitioner', 'respondent'];
      if (sideA === sideB) bump(together, a.slug, b.slug, key);
      else if (both.includes(sideA) && both.includes(sideB)) bump(against, a.slug, b.slug, key);
      // caveator / intervenor / amicus against a party is not an adversary in
      // any useful sense, so those pairs are left out rather than mislabelled.
    }
  }
}

const relationships = [];
let cutTogether = 0, cutAgainst = 0;
for (const [k, cases] of together) {
  const [from, to] = k.split('|');
  if (cases.size < MIN_TOGETHER) { cutTogether++; continue; }
  relationships.push({
    from, to, type: 'co_counsel_with', court: 'supreme-court-of-india',
    strength: Math.min(5, 1 + Math.floor(cases.size / 2)), verified: false,
    note: `On record for the same side in ${cases.size} matters listed between ${days[0]} and ${days[days.length - 1]}.`,
  });
}
for (const [k, cases] of against) {
  const [from, to] = k.split('|');
  if (cases.size < MIN_OPPOSED) { cutAgainst++; continue; }
  relationships.push({
    from, to, type: 'opposed', court: 'supreme-court-of-india',
    strength: Math.min(5, 1 + Math.floor(cases.size / 2)), verified: false,
    note: `On record on opposite sides in ${cases.size} matters listed between ${days[0]} and ${days[days.length - 1]}.`,
  });
}

note('edge thresholds', `co_counsel_with needs ${MIN_TOGETHER}+ shared matters, opposed needs ${MIN_OPPOSED}+. ` +
  `${cutTogether} same-side pairs and ${cutAgainst} opposing pairs fell below that and were dropped — with more ` +
  `days accumulated they will cross it.`);
note('what an appearance is not', `Being on a cause list means being on record for a party that day. It does not ` +
  `mean the matter was reached, or that this person argued it. No seniority or mentorship is inferred from any ` +
  `edge here.`);

const source = {
  kind: 'cause_list', title: `Supreme Court daily cause lists, ${days[0]} to ${days[days.length - 1]}`,
  url: 'https://www.sci.gov.in/cause-list/', retrieved_at: new Date().toISOString().slice(0, 10),
  note: `Derived from ${files.length} daily lists by scripts/derive-cause-lists.js.`,
};
for (const p of people) p.sources = [source];

const out = {
  // An overlay, not a record of truth: these entries carry only court practice,
  // and must not blank the name, practice areas or firm that other files own.
  _merge: true,
  _note: `Generated by scripts/derive-cause-lists.js from ${files.length} daily cause lists in ` +
         `data/cause-lists/. Regenerate rather than editing — it is rebuilt from the .jsonl files every run.`,
  _review: review,
  organisations: [], people, relationships, matters: [],
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  sitting days      ${days.length}  (${days[0]} … ${days[days.length - 1]})`);
console.log(`  appearances       ${rows.length}  (${resolved.length} resolved)`);
console.log(`  people touched    ${people.length}`);
console.log(`  co-counsel edges  ${relationships.filter(r => r.type === 'co_counsel_with').length}`);
console.log(`  opposed edges     ${relationships.filter(r => r.type === 'opposed').length}`);
console.log(`\nReview log:`);
for (const r of review) console.log(`  - ${r}`);
