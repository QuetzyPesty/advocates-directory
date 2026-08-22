#!/usr/bin/env node
// ============================================================================
// Convert the deal-coverage database at "structuring mbox" into import JSON.
//
//   npm run convert:firms -- "/path/to/legal_directory.db" data/firm-partners.json
//
// The source is a SQLite file built from Bar & Bench deal reports: firms,
// people with a role string, deals with a URL, and who acted on what. This
// script lifts the PARTNER-LEVEL people out of it — partners, senior/managing
// partners, counsel, and practice heads — together with the firms they sit in,
// the deals they are named on, and the practice areas those deals were tagged
// with.
//
// What it will not do:
//   * invent a city, a bar council, an enrolment year, or a call date — the
//     source has none of those, so the records are left empty rather than
//     guessed at;
//   * infer a practice area from a firm or a job title. Areas come only from
//     the practice-area tag on a deal the person is actually named on;
//   * merge two people who happen to share a name. Where the source has the
//     same name at two firms it writes two records, suffixes the slugs, and
//     says so in a note and in _review.
//
// Associates are deliberately excluded — pass --include-associates to bring
// the whole ladder in instead.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const positional = argv.filter(a => !a.startsWith('--'));

const SRC = positional[0] || '/Users/anandiyer/structuring mbox/legal_directory.db';
const OUT = positional[1] || 'data/firm-partners.json';
const INCLUDE_ASSOCIATES = flag('include-associates');

const review = [];
const note = (kind, msg) => review.push(`${kind}: ${msg}`);

const db = new DatabaseSync(SRC, { readOnly: true });
const q = (sql, params = []) => db.prepare(sql).all(...params);

// --- vocabulary bridges -----------------------------------------------------

// The source tags a deal with one of six broad areas. Each maps onto exactly
// one slug in db/02-taxonomy.sql; private-equity-vc is the one this import
// adds to the taxonomy.
const AREA_SLUG = {
  'Mergers & Acquisitions': 'ma-transactions',
  'Capital Markets': 'securities-law',
  'Private Equity & Venture Capital': 'private-equity-vc',
  'Banking & Finance': 'banking-finance',
  'Corporate & Commercial': 'company-law',
  'Restructuring & Insolvency': 'insolvency',
};

// Free-text role strings -> affiliation role enum. Anything containing
// "Partner" that isn't senior/managing/equity lands on `partner`.
function affiliationRole(role) {
  const r = (role || '').toLowerCase();
  if (/managing partner/.test(r)) return 'managing_partner';
  if (/equity partner/.test(r)) return 'equity_partner';
  if (/senior partner/.test(r)) return 'partner';
  if (/founder/.test(r)) return 'founder';
  if (/associate partner/.test(r)) return 'partner';
  if (/\bpartner\b/.test(r)) return 'partner';
  if (/of counsel/.test(r)) return 'of_counsel';
  if (/counsel/.test(r)) return 'counsel';
  if (/principal associate/.test(r)) return 'principal_associate';
  if (/senior associate/.test(r)) return 'senior_associate';
  if (/associate/.test(r)) return 'associate';
  if (/\bprincipal\b/.test(r)) return 'partner';
  if (/head|director/.test(r)) return 'partner';
  return 'other';
}

// Which rows count as "partner level" for the default import.
const PARTNER_LEVEL = new Set([
  'partner', 'equity_partner', 'managing_partner', 'founder', 'counsel', 'of_counsel',
]);

const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- firms ------------------------------------------------------------------

const firmRows = q(`SELECT id, name FROM firms`);
const firmSlug = new Map();
for (const f of firmRows) firmSlug.set(f.id, slugify(f.name));

// Only emit firms that end up with at least one person or one matter.
const firmUsed = new Set();

// --- people -----------------------------------------------------------------

const peopleRows = q(`
  SELECT p.id, p.name, p.role, p.firm_id, f.name AS firm_name
  FROM people p LEFT JOIN firms f ON f.id = p.firm_id`);

const kept = peopleRows.filter(p => {
  const role = affiliationRole(p.role);
  return INCLUDE_ASSOCIATES ? role !== 'other' : PARTNER_LEVEL.has(role);
});

// Same name in the source at more than one firm: two records, suffixed slugs.
const nameCount = new Map();
for (const p of kept) nameCount.set(p.name, (nameCount.get(p.name) || 0) + 1);

// Slugs already claimed by the other datasets in data/. An import upserts on
// slug, so reusing one silently asserts that two extracted names are the same
// human — exactly the claim this script refuses to make. Suffix instead.
const claimed = new Map();         // slug -> which file claimed it
const dataDir = path.dirname(path.resolve(OUT));
if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.json') || f === path.basename(OUT) || f === 'import-template.json') continue;
    try {
      for (const p of JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')).people || []) {
        if (p.slug) claimed.set(p.slug, f);
      }
    } catch { /* not an import file; ignore */ }
  }
}

const slugOf = new Map();          // source person id -> slug
const usedSlugs = new Map();
for (const p of kept) {
  let s = slugify(p.name);
  if (claimed.has(s) && p.firm_id) {
    note('name already in the directory',
      `${p.name} is already a record in ${claimed.get(s)}. Imported separately as a firm-side record rather than merged — they may or may not be the same person.`);
    s = `${s}-${slugify(p.firm_name).split('-').slice(0, 2).join('-')}`;
  }
  else if (nameCount.get(p.name) > 1 && p.firm_id) {
    s = `${s}-${slugify(p.firm_name).split('-').slice(0, 2).join('-')}`;
  }
  while (usedSlugs.has(s) && usedSlugs.get(s) !== p.id) s = `${s}-2`;
  usedSlugs.set(s, p.id);
  slugOf.set(p.id, s);
}
for (const [name, n] of nameCount) {
  if (n > 1) {
    const where = kept.filter(p => p.name === name).map(p => p.firm_name).join(', ');
    note('same name, two firms', `${name} appears at ${where}. Kept as separate records — this could be a lateral move, a misattribution in the source, or two different people. Not merged.`);
  }
}

// --- deals ------------------------------------------------------------------

const dealRows = q(`SELECT id, headline, client, source, url, snippet FROM deals`);
const dealById = new Map(dealRows.map(d => [d.id, d]));

const dealAreas = new Map();
for (const r of q(`SELECT deal_id, area FROM deal_practice_areas`)) {
  if (!dealAreas.has(r.deal_id)) dealAreas.set(r.deal_id, []);
  const slug = AREA_SLUG[r.area];
  if (slug) dealAreas.get(r.deal_id).push(slug);
  else note('unmapped practice area', `"${r.area}" has no slug in the taxonomy; dropped.`);
}

const dealTypes = new Map();
for (const r of q(`SELECT deal_id, type FROM deal_types`)) {
  if (!dealTypes.has(r.deal_id)) dealTypes.set(r.deal_id, []);
  dealTypes.get(r.deal_id).push(r.type);
}

const dealFirms = new Map();
for (const r of q(`SELECT deal_id, firm_id FROM deal_firms`)) {
  if (!dealFirms.has(r.deal_id)) dealFirms.set(r.deal_id, []);
  dealFirms.get(r.deal_id).push(r.firm_id);
}

// Every person named on a deal, including the associates we are not importing —
// needed so the co-counsel edges are drawn between the right pairs.
const dealTeam = new Map();        // deal_id -> [{person_id, client_override}]
for (const r of q(`SELECT person_id, deal_id, client_override FROM person_deals`)) {
  if (!dealTeam.has(r.deal_id)) dealTeam.set(r.deal_id, []);
  dealTeam.get(r.deal_id).push(r);
}

const personDeals = new Map();     // source person id -> [deal_id]
for (const [dealId, team] of dealTeam) {
  for (const t of team) {
    if (!personDeals.has(t.person_id)) personDeals.set(t.person_id, []);
    personDeals.get(t.person_id).push(dealId);
  }
}

const firmOf = new Map(peopleRows.map(p => [p.id, p.firm_id]));

// --- assemble people --------------------------------------------------------

const people = [];
const YEAR = /\b(20\d{2}|19\d{2})\b/;

for (const p of kept) {
  const slug = slugOf.get(p.id);
  const deals = personDeals.get(p.id) || [];

  // Practice areas: counted across the deals this person is actually named on.
  const areaCount = new Map();
  for (const d of deals) for (const a of dealAreas.get(d) || []) {
    areaCount.set(a, (areaCount.get(a) || 0) + 1);
  }
  const ranked = [...areaCount].sort((a, b) => b[1] - a[1]);
  const top = ranked.length ? ranked[0][1] : 0;
  const practice_areas = ranked.map(([slug, n]) => ({
    slug,
    emphasis: n === top && top > 0 ? 'primary' : 'secondary',
    evidence_note: `Named on ${n} reported ${n === 1 ? 'matter' : 'matters'} tagged to this area.`,
  }));

  // Sources: the deal reports themselves, newest-URL-first is not knowable, so
  // take them in source order and cap the list.
  const sources = deals.slice(0, 6).map(id => {
    const d = dealById.get(id);
    return {
      kind: 'news',
      title: d.headline || 'Deal report',
      url: d.url,
      note: d.source || undefined,
    };
  }).filter(s => s.url);

  const firmName = p.firm_name;
  if (p.firm_id) firmUsed.add(p.firm_id);

  const roleLabel = p.role || 'Partner';
  const notes = [];
  if (nameCount.get(p.name) > 1) {
    notes.push({
      kind: 'source',
      body: `Another lawyer recorded under this name appears at ${
        kept.filter(x => x.name === p.name && x.id !== p.id).map(x => x.firm_name).join(', ')
      } in the deal-report data. Not merged — check before treating them as the same person.`,
    });
  }

  people.push({
    slug,
    full_name: p.name,
    designation: 'advocate',
    primary_organisation: p.firm_id ? firmSlug.get(p.firm_id) : undefined,
    headline: firmName ? `${roleLabel}, ${firmName}` : roleLabel,
    short_bio: deals.length
      ? `Transactional lawyer${firmName ? ` at ${firmName}` : ''}. Named as acting counsel on ${deals.length} reported ${deals.length === 1 ? 'transaction' : 'transactions'} in the Bar & Bench deal coverage this directory was built from.`
      : undefined,
    accepts_direct_briefs: true,
    verification_status: sources.length ? 'source_backed' : 'unverified',
    practice_areas,
    affiliations: p.firm_id ? [{
      organisation: firmSlug.get(p.firm_id),
      role: affiliationRole(p.role),
      is_current: true,
      note: /partner|counsel|associate|principal/i.test(roleLabel) && !/,/.test(roleLabel)
        ? undefined : `Recorded as "${roleLabel}".`,
    }] : [],
    sources,
    notes: notes.length ? notes : undefined,
  });
}

// --- matters ----------------------------------------------------------------

const importedIds = new Set(kept.map(p => p.id));
const matters = [];
const seenTitle = new Set();

for (const d of dealRows) {
  const team = (dealTeam.get(d.id) || []).filter(t => importedIds.has(t.person_id));
  if (!team.length) continue;
  const title = (d.headline || '').trim();
  if (!title || seenTitle.has(title)) continue;
  seenTitle.add(title);

  const year = (d.snippet || '').match(YEAR);
  const areas = dealAreas.get(d.id) || [];
  const types = dealTypes.get(d.id) || [];
  for (const fid of dealFirms.get(d.id) || []) firmUsed.add(fid);

  matters.push({
    title,
    year: year ? Number(year[1]) : undefined,
    practice_area: areas[0],
    summary: [
      d.client ? `Client: ${d.client}.` : null,
      types.length ? `Reported as: ${types.join(', ')}.` : null,
      (d.snippet || '').trim().slice(0, 400) || null,
    ].filter(Boolean).join(' '),
    url: d.url || undefined,
    counsel: team.map(t => ({
      person: slugOf.get(t.person_id),
      role: 'arguing_counsel',
      side: t.client_override || d.client || undefined,
    })),
  });
}

// --- relationships ----------------------------------------------------------
// Derived only from having acted on the same reported transaction. Same firm ->
// colleague_of; different firms -> co_counsel_with. Both symmetric, so each
// unordered pair is written once, with strength scaled by how many matters the
// pair shares (capped at 5).

const pairCount = new Map();
for (const [dealId, team] of dealTeam) {
  const inScope = team.map(t => t.person_id).filter(id => importedIds.has(id));
  for (let i = 0; i < inScope.length; i++) {
    for (let j = i + 1; j < inScope.length; j++) {
      const [a, b] = [inScope[i], inScope[j]].sort((x, y) => x - y);
      const key = `${a}|${b}`;
      if (!pairCount.has(key)) pairCount.set(key, 0);
      pairCount.set(key, pairCount.get(key) + 1);
    }
  }
}

const relationships = [];
for (const [key, n] of pairCount) {
  const [a, b] = key.split('|').map(Number);
  const sameFirm = firmOf.get(a) && firmOf.get(a) === firmOf.get(b);
  relationships.push({
    from: slugOf.get(a),
    to: slugOf.get(b),
    type: sameFirm ? 'colleague_of' : 'co_counsel_with',
    organisation: sameFirm ? firmSlug.get(firmOf.get(a)) : undefined,
    strength: Math.min(5, 2 + n),
    verified: false,
    note: `Named together on ${n} reported ${n === 1 ? 'transaction' : 'transactions'}.`,
  });
}
note('derived edges', `${relationships.length} relationships inferred from shared deal teams alone. They record co-appearance, not seniority — no chamber or mentorship edge is claimed.`);

// --- organisations ----------------------------------------------------------

const organisations = firmRows.filter(f => firmUsed.has(f.id)).map(f => ({
  slug: firmSlug.get(f.id),
  name: f.name,
  type: 'law_firm',
}));

const dropped = firmRows.filter(f => !firmUsed.has(f.id)).map(f => f.name);
if (dropped.length) note('firms dropped', `${dropped.join(', ')} — named in the source but with no partner and no matter attached.`);

const noAreas = people.filter(p => !p.practice_areas.length).length;
if (noAreas) note('no practice area', `${noAreas} of ${people.length} people are on no deal carrying a practice-area tag. Left blank rather than guessed from their firm.`);

note('not in the source', `Bar Council, enrolment year, year of call, city and languages are absent from the deal reports, so every record here has them empty. They are not derivable from a deal write-up.`);
if (!INCLUDE_ASSOCIATES) {
  const assoc = peopleRows.length - kept.length;
  note('associates excluded', `${assoc} associate-level people in the source were not imported. Re-run with --include-associates to bring them in.`);
}

// --- write ------------------------------------------------------------------

const out = {
  _note: `Generated by scripts/convert-firm-db.js from ${path.basename(SRC)} (Bar & Bench deal coverage). Every person cites the deal reports they are named in.`,
  _review: review,
  organisations,
  people,
  relationships,
  matters,
};

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`  organisations ${organisations.length}`);
console.log(`  people        ${people.length}${INCLUDE_ASSOCIATES ? '' : ' (partner level)'}`);
console.log(`  relationships ${relationships.length}`);
console.log(`  matters       ${matters.length}`);
console.log(`\nReview log:`);
for (const r of review) console.log(`  - ${r}`);
