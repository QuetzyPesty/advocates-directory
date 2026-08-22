#!/usr/bin/env node
// ============================================================================
// Fetch Supreme Court daily cause lists and append the appearances they record.
//
//   npm run scrape:causelist                    # every list on the page today
//   npm run scrape:causelist -- --date=2026-08-25
//   npm run scrape:causelist -- --keep-pdf      # also save the PDFs
//
// One gzipped JSON Lines file per day under data/cause-lists/. Deterministic:
// re-running a day rewrites that day's file with the same content, so the
// scheduled job is safe to retry and produces no diff when nothing changed.
// Gzipped because a scheduled job commits these forever — a year of raw lists
// is a hundred megabytes of repository, and about eight compressed.
//
// The value is cumulative. A single day tells you who was listed once; a term's
// worth tells you which courts an advocate actually practises in and who they
// keep appearing alongside — facts no profile page states.
//
// Politeness: one request at a time, a delay between them, a real contact
// string in the User-Agent. These are public records on a government server
// that falls over easily; there is no reason to hammer it.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractText } from './lib/pdf-text.js';
import { parseCauseList, nameIndex } from './lib/cause-list.js';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.resolve(ROOT, opt('out-dir', 'data/cause-lists'));
const PDF_DIR = path.resolve(ROOT, opt('pdf-dir', 'db/sources/cause-lists'));
const INDEX_URL = 'https://www.sci.gov.in/cause-list/';
const DELAY_MS = Number(opt('delay', 1500));
const WANT_DATE = opt('date', null);
const KEEP_PDF = flag('keep-pdf');
const UA = 'advocates-directory/0.1 (personal research; one request at a time)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, asBuffer = false) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return asBuffer ? Buffer.from(await res.arrayBuffer()) : res.text();
}

// --- discover today's lists -------------------------------------------------
// The URLs are predictable (…/jonew/cl/<date>/M_J_1.pdf) but which lists exist
// on a given day is not — a non-sitting day has none, and the suffixes vary.
// Reading the page is the only way to know what to ask for.

const html = await get(INDEX_URL);
const links = [...new Set([...html.matchAll(/https:\/\/api\.sci\.gov\.in\/jonew\/cl\/[^"']+\.pdf/g)].map(m => m[0]))]
  .map(url => {
    const m = url.match(/\/cl\/(?:advance\/)?(\d{4}-\d{2}-\d{2})\/([A-Z_0-9]+)\.pdf$/);
    return m ? { url, date: m[1], list: m[2], advance: url.includes('/advance/') } : null;
  })
  .filter(Boolean)
  // An advance list is provisional and gets superseded by the daily one; taking
  // both would double-count every appearance on it.
  .filter(l => !l.advance);

if (!links.length) {
  console.error(`No cause-list PDFs found on ${INDEX_URL}. Either the Court is not sitting, or the page changed.`);
  process.exit(0);
}

const dates = [...new Set(links.map(l => l.date))].sort();
const target = WANT_DATE || dates[dates.length - 1];
const wanted = links.filter(l => l.date === target);
if (!wanted.length) {
  console.error(`No lists published for ${target}. Available: ${dates.join(', ')}`);
  process.exit(0);
}

// --- the roll, for matching names to people ---------------------------------

const rollPath = path.join(ROOT, 'data', 'aor-list.json');
if (!fs.existsSync(rollPath)) {
  console.error(`data/aor-list.json is missing. Run "npm run convert:aor" first — without the roll there is\n` +
    `nothing to match the names in a cause list against, and every appearance would be an unresolved string.`);
  process.exit(1);
}
const roll = JSON.parse(fs.readFileSync(rollPath, 'utf8')).people;
// Anyone else already in the directory is worth matching too — a Senior
// Advocate is named in a cause list without being on the AoR roll.
const others = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
  if (!f.endsWith('.json') || f === 'aor-list.json' || f === 'import-template.json') continue;
  try { others.push(...(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')).people || [])); }
  catch { /* not an import file */ }
}
const index = nameIndex([...roll, ...others]);

// --- fetch and parse --------------------------------------------------------

const all = [];
const unmatched = new Map();
let tagged = 0, matched = 0;

for (const [i, l] of wanted.entries()) {
  if (i) await sleep(DELAY_MS);
  process.stderr.write(`  ${l.date} ${l.list} … `);
  let pdf;
  try { pdf = await get(l.url, true); }
  catch (e) { process.stderr.write(`FAILED (${e.message})\n`); continue; }

  if (KEEP_PDF) {
    fs.mkdirSync(path.join(PDF_DIR, l.date), { recursive: true });
    fs.writeFileSync(path.join(PDF_DIR, l.date, `${l.list}.pdf`), pdf);
  }

  const text = extractText(pdf);
  if (text.decoded < 0.9) {
    process.stderr.write(`skipped — only ${(text.decoded * 100).toFixed(0)}% of characters decoded\n`);
    continue;
  }
  const r = parseCauseList(text.text, index, { date: l.date, list: l.list });
  all.push(...r.appearances);
  tagged += r.stats.tagged;
  matched += r.stats.matched;
  for (const [name, n] of r.unmatched) unmatched.set(name, (unmatched.get(name) || 0) + n);
  process.stderr.write(`${r.stats.tagged} appearances, ${r.stats.matched} matched, ` +
    `${r.stats.items} items, ${r.stats.benches} benches\n`);
}

if (!all.length) { console.error('Nothing parsed.'); process.exit(0); }

// --- write ------------------------------------------------------------------
// Sorted so the file is byte-identical on a re-run: a scheduled job that
// commits its output must not produce a diff when nothing changed.

all.sort((a, b) => (a.list || '').localeCompare(b.list || '')
  || (a.item ?? 0) - (b.item ?? 0)
  || (a.name || '').localeCompare(b.name || ''));

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `${target}.jsonl.gz`);

// The output has to be byte-identical for identical input, or the scheduled job
// commits a no-op every day. Two header fields defeat that on their own:
// the timestamp, which `mtime: 0` pins, and byte 9 — the OS code — which zlib
// fills in from the host: 0x13 on macOS, 0x03 on Linux. A file written on a
// laptop and rewritten by the Linux runner then differs in exactly one byte
// while the content is identical. Pin it to 0xFF, "unknown", which is what this
// is: a deliberately host-independent artefact.
const gz = zlib.gzipSync(
  Buffer.from(all.map(a => JSON.stringify(a)).join('\n') + '\n'), { level: 9, mtime: 0 });
gz[9] = 0xff;
fs.writeFileSync(outFile, gz);

const rate = tagged ? (100 * matched / tagged).toFixed(1) : '0.0';
console.log(`${path.relative(ROOT, outFile)}`);
console.log(`  appearances   ${all.length}`);
console.log(`  matched       ${matched} (${rate}%)`);
console.log(`  unresolved    ${tagged - matched}`);
console.log(`  cases         ${new Set(all.map(a => a.case)).size}`);
console.log(`  benches       ${new Set(all.map(a => a.court)).size}`);
if (Number(rate) < 80) {
  console.log(`\n  Match rate is low. Either the roll is stale (re-run convert:aor) or the list format moved.`);
}
const top = [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 10);
if (top.length) {
  console.log(`\n  Names not on the roll (usually AoR firms — "M/s Parekh & Co" files as a firm, not a person):`);
  for (const [n, c] of top) console.log(`    ${String(c).padStart(3)}  ${n}`);
}
