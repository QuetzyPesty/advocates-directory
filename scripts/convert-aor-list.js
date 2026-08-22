#!/usr/bin/env node
// ============================================================================
// Convert the Supreme Court's "List of Advocates-on-Record" into import JSON.
//
//   npm run convert:aor                       # fetch the current list and parse
//   npm run convert:aor -- --pdf=local.pdf    # parse a copy already on disk
//   npm run convert:aor -- --out=data/aor.json --keep-pdf=db/sources/aor.pdf
//   npm run convert:aor -- --skip-inactive    # drop expired / removed entries
//
// The list is the Registry's own roll: every advocate entitled to file in the
// Supreme Court, with the date they were registered, their registration number,
// their code as it appears in cause lists, and a remarks column that records
// Senior Advocate designation, elevation to the Bench, death and removal.
//
// It is the only source that makes `is_aor`, `aor_year` and `aor_code` true
// rather than asserted — and the code is what lets a cause list be matched back
// to a person.
//
// What it does not do: invent anything the list does not say. There is no
// practice area, no education, no Bar Council in this document, so those fields
// come out empty. Chamber addresses, phone numbers and emails are imported as
// PRIVATE contacts — they are published by the Court, but a shared export
// should not carry them, and `is_public: false` is what keeps them out.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { extractText } from './lib/pdf-text.js';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const OUT = opt('out', 'data/aor-list.json');
const PDF_IN = opt('pdf', null);
const KEEP_PDF = opt('keep-pdf', null);
const SKIP_INACTIVE = flag('skip-inactive');
const INDEX_URL = 'https://www.sci.gov.in/advocate-on-record/';
const UA = 'advocates-directory/0.1 (personal research; contact via repository owner)';

const review = [];
const note = (kind, msg) => review.push(`${kind}: ${msg}`);

// --- locate and fetch the current list --------------------------------------

/**
 * The PDF's URL carries its publication date, so it changes every time the
 * Registry reissues the list. Hard-coding it guarantees a stale file within
 * months; the link is therefore discovered from the AoR page each run.
 */
async function findListUrl() {
  const res = await fetch(INDEX_URL, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${INDEX_URL} returned ${res.status}`);
  const html = await res.text();
  const hits = [...html.matchAll(/href="(https:\/\/cdn[^"]*\.pdf)"[^>]*>([\s\S]{0,200}?)<\/a>/g)]
    .map(m => ({ url: m[1], text: m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter(h => /list of\s*AOR|advocates?[- ]on[- ]record/i.test(h.text));
  if (!hits.length) {
    throw new Error(`No "List of AOR" link found on ${INDEX_URL}. The page layout changed — check it by hand.`);
  }
  if (hits.length > 1) note('multiple candidates', `${hits.length} links matched; used "${hits[0].text}".`);
  return hits[0];
}

let pdf, sourceUrl, sourceTitle;
if (PDF_IN) {
  pdf = fs.readFileSync(PDF_IN);
  sourceUrl = opt('source-url', `file://${path.resolve(PDF_IN)}`);
  sourceTitle = opt('source-title', `List of Advocates-on-Record (${path.basename(PDF_IN)})`);
} else {
  const hit = await findListUrl();
  sourceUrl = hit.url;
  sourceTitle = hit.text;
  process.stderr.write(`Fetching ${hit.text}\n  ${hit.url}\n`);
  const res = await fetch(hit.url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  pdf = Buffer.from(await res.arrayBuffer());
  if (KEEP_PDF) {
    fs.mkdirSync(path.dirname(path.resolve(KEEP_PDF)), { recursive: true });
    fs.writeFileSync(KEEP_PDF, pdf);
  }
}

const parsed = extractText(pdf);
process.stderr.write(`  ${parsed.pages} pages, ${(parsed.decoded * 100).toFixed(1)}% of characters decoded via ToUnicode\n`);
if (parsed.decoded < 0.9) {
  throw new Error(`Only ${(parsed.decoded * 100).toFixed(1)}% of the text decoded. The PDF uses an encoding ` +
    `scripts/lib/pdf-text.js does not implement — parsing it would produce mojibake. Stopping.`);
}
const lines = parsed.text.split('\n').map(l => l.trim());

// --- grammar ----------------------------------------------------------------

const TITLE = /^(Sh|Smt|Ms|Mr|Mrs|Dr|Km|Kum|Miss|Prof|Justice)\.?$/i;
const DATE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/;
const DIGITS = /^\d+$/;
const NOISE = new Set([
  'SUPREME COURT OF INDIA', '(Record Room)', 'List of Advocates-on-Record',
  'Sl. No.', 'Name & Address', 'Date of', 'registration', 'as an AOR',
  'File No./', 'Reg.No.', 'Remarks', 'CC. Code', 'M', 'P a g e', '|', '(as on',
]);
const isNoise = l => !l || NOISE.has(l) || /^[=\s]+$/.test(l) || /^\.?\d{2}\.\d{4}\)?$/.test(l);

/** A serial number: digits, immediately followed by a title or a person's name. */
function isEntryStart(i) {
  if (!DIGITS.test(lines[i])) return false;
  let j = i + 1;
  while (j < lines.length && isNoise(lines[j])) j++;
  const next = lines[j];
  if (!next || DIGITS.test(next) || DATE.test(next)) return false;
  // Either a bare title line, or a name that already carries its title.
  return TITLE.test(next) || /^(Mr|Ms|Mrs|Dr|Sh|Smt|Km|Kum|Prof|Justice)\.\s+\S/i.test(next)
      || /\((Advocate|Attorney)\)\s*$/i.test(next);
}

const starts = [];
for (let i = 0; i < lines.length; i++) if (isEntryStart(i)) starts.push(i);
note('entries found', `${starts.length} numbered entries across ${parsed.pages} pages.`);

// --- per-entry parsing ------------------------------------------------------

const EMAIL = /[\w][\w.+-]*@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?91[\s-]?)?\b\d{10}\b|\b\d{5}[\s-]\d{5}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/;

const titleCase = s => s.replace(/\S+/g, w =>
  /^[A-Z][a-z]/.test(w) ? w
    : w.length <= 3 && /^[A-Z.]+$/.test(w) ? w              // initials: A D, K.K.
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function yearFrom(d) {
  const m = DATE.exec(d);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += y > 60 ? 1900 : 2000;      // "14/01/09" is 2009; "9/8/61" is 1961
  return y >= 1900 && y <= 2100 ? y : null;
}

function parseEntry(from, to) {
  const raw = lines.slice(from + 1, to).filter(l => !isNoise(l));
  if (!raw.length) return null;

  let k = 0;
  if (TITLE.test(raw[k])) k++;                  // bare title column
  let name = raw[k++];
  if (!name) return null;

  // "(Advocate)" / "(Attorney)" is the roll's own classification and marks the
  // end of the name. It is not always the end of the LINE: where the extractor
  // put the name and the first address line on one baseline, everything after
  // the marker is address, and must not end up inside the name.
  // A handful of rows are cross-references rather than people.
  if (/^please\s+see\s+entry/i.test(name)) return null;

  let attorney = false, spilled = null, alsoKnownAs = null;
  // The marker may be bare — "(Advocate)" — or carry an alternate spelling of
  // the name — "(Devendra Nath Goburdhun, Advocate)" — or appear without
  // brackets at all: "Santosh Paul, Advocate 52A H Block, …".
  const kind = name.match(/\(\s*(?:([^)]*?),\s*)?(Advocate|Attorney)\s*\)|,\s*(Advocate|Attorney)\b/i);
  if (kind) {
    attorney = /attorney/i.test(kind[2] || kind[3]);
    if (kind[1]) alsoKnownAs = kind[1].trim();
    const after = name.slice(kind.index + kind[0].length).trim();
    if (after) spilled = after;
    name = name.slice(0, kind.index).trim();
  } else {
    // No marker at all. Split only where what follows is unmistakably an
    // address, never on a comma that might sit inside a name.
    const glue = name.match(/\s(?=(?:Chamber|Ch\.|C\/o|Flat|House|No\.|Plot|Block)\b|\d+[,/\-])/i);
    if (glue && glue.index > 6) { spilled = name.slice(glue.index).trim(); name = name.slice(0, glue.index).trim(); }
  }
  name = name.replace(/^(Sh|Smt|Ms|Mr|Mrs|Dr|Km|Kum|Miss|Prof)\.?\s+/i, '').trim();
  if (name === name.toUpperCase()) name = titleCase(name);
  if (!/[A-Za-z]/.test(name)) return null;

  const rest = spilled ? [spilled, ...raw.slice(k)] : raw.slice(k);
  const dIdx = rest.findIndex(l => DATE.test(l));
  const head = dIdx < 0 ? rest : rest.slice(0, dIdx);
  const tail = dIdx < 0 ? [] : rest.slice(dIdx + 1);
  const registered = dIdx < 0 ? null : rest[dIdx];

  const emails = [], phones = [], address = [];
  for (const l of head) {
    const e = l.match(EMAIL);
    const p = l.match(PHONE);
    if (e) emails.push(e[0]);
    if (p) phones.push(p[0].replace(/\s|-/g, ''));
    if (!e && !p) address.push(l);
  }

  const numbers = tail.filter(l => DIGITS.test(l));
  const remarks = tail.filter(l => !DIGITS.test(l)).join(' ').replace(/\s+/g, ' ').trim();

  return {
    name, attorney, registered, alsoKnownAs,
    regNo: numbers[0] ?? null,
    ccCode: numbers.length > 1 ? numbers[numbers.length - 1] : null,
    address: address.join(', ').replace(/\s*,\s*,/g, ',').trim(),
    emails: [...new Set(emails)], phones: [...new Set(phones)],
    remarks,
  };
}

const entries = [];
for (let i = 0; i < starts.length; i++) {
  const e = parseEntry(starts[i], i + 1 < starts.length ? starts[i + 1] : lines.length);
  if (e) entries.push(e); else note('unparsed entry', `serial ${lines[starts[i]]} could not be read; skipped.`);
}

// --- remarks column ---------------------------------------------------------

const SENIOR = /designated\s+as\s+(?:sr\.?|senior)\s+advocate/i;
const DEAD = /\bexpired\b|\bdeceased\b|\bdied\b|\blate\b\s+sh/i;
const GONE = /\bremoved\b|\bname\s+removed\b|\bstruck\s+off\b|\bceased\b|\bresigned\b|\bsuspended\b|\bcancelled\b/i;
const BENCH = /\belevated\b|\bappointed\s+as\s+(?:a\s+)?judge\b/i;
const ANY_YEAR = /(?:^|\D)(19\d{2}|20\d{2})(?:\D|$)/g;
const SHORT_YEAR = /\b\d{1,2}[./-]\d{1,2}[./-](\d{2})\b/;

function readRemarks(r) {
  const out = { senior: false, seniorYear: null, status: null, nameChange: null };
  if (!r) return out;
  if (SENIOR.test(r)) {
    out.senior = true;
    const seg = r.slice(r.search(SENIOR));
    const years = [...seg.matchAll(ANY_YEAR)].map(m => Number(m[1]));
    if (years.length) out.seniorYear = years[0];
    else {
      const s = seg.match(SHORT_YEAR);
      if (s) { const y = Number(s[1]); out.seniorYear = y > 60 ? 1900 + y : 2000 + y; }
    }
  }
  if (DEAD.test(r)) out.status = 'deceased';
  else if (BENCH.test(r)) out.status = 'on_bench';
  else if (GONE.test(r)) out.status = 'inactive';
  const nc = r.match(/name\s+changed[^.]*?from\s+(.+?)(?:\s+to\s+|$)/i);
  if (nc) out.nameChange = nc[1].trim();
  return out;
}

// --- slug allocation --------------------------------------------------------
// Two records sharing a name are never merged, inside this list or against the
// datasets already in data/. A shared name is not evidence of a shared person.

const claimed = new Map();
const dataDir = path.dirname(path.resolve(OUT));
if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.json') || f === path.basename(OUT) || f === 'import-template.json') continue;
    try {
      for (const p of JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')).people || []) {
        if (p.slug) claimed.set(p.slug, f);
      }
    } catch { /* not an import file */ }
  }
}

const used = new Set();
const crossFile = [];
function allocate(name) {
  const base = slugify(name);
  let s = base;
  if (claimed.has(base)) { s = `${base}-aor`; crossFile.push(`${name} (already in ${claimed.get(base)})`); }
  let n = 2;
  while (used.has(s)) s = `${base}${claimed.has(base) ? '-aor' : ''}-${n++}`;
  used.add(s);
  return s;
}

// --- build ------------------------------------------------------------------

const RETRIEVED = new Date().toISOString().slice(0, 10);
const source = { kind: 'court_record', title: sourceTitle, url: sourceUrl, retrieved_at: RETRIEVED,
                 note: 'Supreme Court of India, Record Room — the Registry’s own roll of Advocates-on-Record.' };

const people = [];
const counts = { senior: 0, deceased: 0, inactive: 0, on_bench: 0, withCode: 0, withEmail: 0, skipped: 0 };
const dupNames = new Map();
for (const e of entries) dupNames.set(e.name, (dupNames.get(e.name) || 0) + 1);

for (const e of entries) {
  const r = readRemarks(e.remarks);
  if (SKIP_INACTIVE && r.status && r.status !== 'on_bench') { counts.skipped++; continue; }

  const aorYear = e.registered ? yearFrom(e.registered) : null;
  const contacts = [];
  // Published by the Court, but private here: an export must not carry them.
  if (e.address) contacts.push({ kind: 'chambers_address', value: e.address, is_public: false });
  for (const p of e.phones) contacts.push({ kind: 'phone', value: p, is_public: false });
  for (const m of e.emails) contacts.push({ kind: 'email', value: m, is_public: false });

  const credentials = [];
  if (e.regNo) credentials.push({ kind: 'bar_admission', name: `Advocate-on-Record registration no. ${e.regNo}`,
                                  issuer: 'Supreme Court of India', year: aorYear ?? undefined });

  const notes = [];
  if (e.remarks) notes.push({ kind: 'source', body: `Registry remarks column: “${e.remarks}”` });
  if (r.nameChange) notes.push({ kind: 'source', body: `The roll records an earlier name: ${r.nameChange}.` });
  if (e.alsoKnownAs) notes.push({ kind: 'source', body: `The roll also gives the name as: ${e.alsoKnownAs}.` });
  if (dupNames.get(e.name) > 1) notes.push({ kind: 'source',
    body: `${dupNames.get(e.name)} entries on the AoR roll carry this name. Kept as separate records — the roll gives no way to tell whether they are the same person.` });

  // "New Delhi" in a chamber address is the Court's own city and is safe to
  // read; anything else is left blank rather than guessed from a postal line.
  const city = /\bnew\s*delhi\b/i.test(e.address) ? 'New Delhi'
    : /\bdelhi\b/i.test(e.address) ? 'Delhi' : null;

  if (r.senior) counts.senior++;
  if (r.status) counts[r.status]++;
  if (e.ccCode) counts.withCode++;
  if (e.emails.length) counts.withEmail++;

  people.push({
    slug: allocate(e.name),
    full_name: e.name,
    // An AoR is by definition entitled to file in the Supreme Court. That is
    // what the roll records, so the court and the designation are not guesses.
    designation: r.senior ? 'senior_advocate_aor' : e.attorney ? 'solicitor' : 'advocate_on_record',
    is_aor: true,
    aor_year: aorYear ?? undefined,
    aor_code: e.ccCode ?? undefined,
    is_senior_advocate: r.senior || undefined,
    senior_designated_year: r.seniorYear ?? undefined,
    senior_designating_court: r.senior ? 'supreme-court-of-india' : undefined,
    first_year_of_practice: undefined,
    status: r.status ?? 'practising',
    primary_court: 'supreme-court-of-india',
    base_city: city ?? undefined,
    base_state: city ? 'Delhi' : undefined,
    headline: r.senior ? 'Senior Advocate and Advocate-on-Record, Supreme Court of India'
                       : e.attorney ? 'Attorney on the Supreme Court roll'
                                    : 'Advocate-on-Record, Supreme Court of India',
    courts: [{ slug: 'supreme-court-of-india', frequency: 'primary', since_year: aorYear ?? undefined,
               note: 'Registered on the roll of Advocates-on-Record.' }],
    verification_status: 'bar_verified',
    contacts, credentials,
    notes: notes.length ? notes : undefined,
    sources: [source],
  });
}

// --- review -----------------------------------------------------------------

note('what the roll gives', `${counts.senior} entries carry a Senior Advocate designation in the remarks column; ` +
  `${counts.withCode} carry a cause-list code; ${counts.withEmail} carry an email address.`);
note('status from remarks', `${counts.deceased} recorded as expired, ${counts.inactive} as removed or resigned, ` +
  `${counts.on_bench} as elevated to a Bench.`);
note('private by default', `Chamber addresses, phone numbers and email addresses are imported with ` +
  `is_public: false. They are published by the Court, but the static export only carries public contacts, ` +
  `so they stay on your machine unless you change that flag deliberately.`);
note('not in the roll', `The list records no practice area, no education, no Bar Council and no year of ` +
  `enrolment at the Bar — only AoR registration. Those fields are left empty.`);
note('honorifics dropped', `The roll carries Sh./Smt./Ms./Mr. titles. They are not imported: the schema does ` +
  `not model gender, and a title merged onto an existing record would stamp one back on.`);
if (crossFile.length) {
  note('name already in the directory', `${crossFile.length} names on the roll match a record already in data/. ` +
    `Each was given a "-aor" slug rather than merged — they may or may not be the same person. ` +
    `Worth resolving by hand: ${crossFile.slice(0, 25).join('; ')}${crossFile.length > 25 ? '; …' : ''}`);
}
const odd = people.filter(p => p.full_name.length > 45 || /\d/.test(p.full_name)).map(p => p.full_name);
if (odd.length) note('names to check by hand', `${odd.length} names came out of the PDF looking wrong — ` +
  `usually a row where the extractor put the name and the address on one baseline: ${odd.slice(0, 10).join(' | ')}`);
const noYear = people.filter(p => !p.aor_year).length;
if (noYear) note('no registration year', `${noYear} entries had no readable registration date.`);
if (SKIP_INACTIVE) note('inactive skipped', `${counts.skipped} expired/removed entries dropped by --skip-inactive.`);

const out = {
  _note: `Generated by scripts/convert-aor-list.js from ${sourceTitle} (${sourceUrl}), retrieved ${RETRIEVED}.`,
  _review: review,
  organisations: [],
  people,
  relationships: [],
  matters: [],
};

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`  people                ${people.length}`);
console.log(`  senior advocates      ${counts.senior}`);
console.log(`  with cause-list code  ${counts.withCode}`);
console.log(`\nReview log:`);
for (const r of review) console.log(`  - ${r}`);
