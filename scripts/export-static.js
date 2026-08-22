#!/usr/bin/env node
// ============================================================================
// Export the directory as ONE self-contained HTML file.
//
//   npm run export                    # -> dist/index.html
//   npm run export -- --out=share.html
//   npm run export -- --verified-only # drop records with no source behind them
//   npm run export -- --substantive   # drop bare roll entries (name + AoR only)
//   npm run export -- --include-notes # DANGER: ships your private notes
//
// No server, no build step, no external requests. Open it with file://, drop it
// on GitHub Pages / Netlify / S3, or email it. Everything works client-side:
// browse, facets, search, profiles, the relationship graph.
//
// PRIVATE NOTES ARE EXCLUDED BY DEFAULT. Passing --include-notes puts them in
// the shared file in plain text; the script says so loudly when you do.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, all } from '../src/db.js';

// A few rules that only apply to the exported page.
const EXTRA_CSS = `
.private-banner strong { color: var(--accent); }
.profile-actions:empty { display: none; }
#graph { height: 600px; }
.hub-cols { grid-template-columns: 1fr; }
`;

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

const INCLUDE_NOTES = flag('include-notes');
// The AoR roll contributes several thousand records that are a name, a
// registration year and a code — the right spine for the local database, and
// dead weight in a file someone else has to load. --substantive keeps only the
// records that carry something beyond that.
const SUBSTANTIVE = flag('substantive');
const VERIFIED_ONLY = flag('verified-only');
const OUT = path.resolve(ROOT, opt('out', 'dist/index.html'));
const TITLE = opt('title', 'Advocates');

// --- pull the dataset -------------------------------------------------------

const where = VERIFIED_ONLY
  ? `WHERE visibility = 'public' AND verification_status <> 'unverified'`
  : `WHERE visibility = 'public'`;

const people = all(`SELECT * FROM v_person ${where} ORDER BY full_name COLLATE NOCASE`);
const ids = new Set(people.map(p => p.id));

const byPerson = (table, sql) => {
  const map = new Map();
  for (const row of all(sql)) {
    if (!ids.has(row.person_id)) continue;
    if (!map.has(row.person_id)) map.set(row.person_id, []);
    map.get(row.person_id).push(row);
  }
  return map;
};

const areas = byPerson('practice_areas', `
  SELECT ppa.person_id, pa.slug, pa.name, ppa.emphasis, ppa.years_active,
         COALESCE(parent.slug, pa.slug) AS root_slug, COALESCE(parent.name, pa.name) AS root_name
  FROM person_practice_area ppa JOIN practice_area pa ON pa.id = ppa.practice_area_id
  LEFT JOIN practice_area parent ON parent.id = pa.parent_id
  ORDER BY CASE ppa.emphasis WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, pa.sort_order`);

const courts = byPerson('courts', `
  SELECT pc.person_id, c.slug, COALESCE(c.short_name, c.name) AS name, c.name AS full_name,
         c.court_type, c.requires_aor, pc.frequency, pc.since_year
  FROM person_court pc JOIN court c ON c.id = pc.court_id
  ORDER BY CASE pc.frequency WHEN 'primary' THEN 0 WHEN 'regular' THEN 1 ELSE 2 END, c.sort_order`);

const languages = byPerson('languages', `
  SELECT pl.person_id, l.code AS slug, l.name, pl.proficiency
  FROM person_language pl JOIN language l ON l.code = pl.language_code ORDER BY l.name`);

const education = byPerson('education', `
  SELECT pe.person_id, i.slug, COALESCE(i.short_name, i.name) AS name, i.name AS full_name,
         pe.degree, pe.field, pe.start_year, pe.end_year
  FROM person_education pe JOIN institution i ON i.id = pe.institution_id
  ORDER BY pe.end_year DESC`);

const affiliations = byPerson('affiliations', `
  SELECT pa.person_id, o.slug, o.name, o.type, pa.role, pa.start_year, pa.end_year, pa.is_current
  FROM person_affiliation pa JOIN organisation o ON o.id = pa.organisation_id
  ORDER BY pa.is_current DESC, pa.start_year DESC`);

const positions = byPerson('positions', `
  SELECT pp.person_id, pp.title, pp.body, pp.start_year, pp.end_year, pp.note
  FROM person_position pp ORDER BY pp.start_year DESC`);

const clerkships = byPerson('clerkships', `
  SELECT pc.person_id, COALESCE(j.full_name, pc.judge_name) AS judge_name, j.slug AS judge_slug,
         c.name AS court_name, pc.start_year, pc.end_year
  FROM person_clerkship pc LEFT JOIN person j ON j.id = pc.judge_person_id
  LEFT JOIN court c ON c.id = pc.court_id`);

const credentials  = byPerson('credentials', `SELECT person_id, name, issuer, year FROM person_credential ORDER BY year DESC`);
const publications = byPerson('publications', `SELECT person_id, title, venue, year, url FROM person_publication ORDER BY year DESC`);
const awards       = byPerson('awards', `SELECT person_id, name, awarded_by, year FROM person_award ORDER BY year DESC`);
const contacts     = byPerson('contacts', `SELECT person_id, kind, label, value FROM person_contact WHERE is_public = 1`);

const notes = INCLUDE_NOTES
  ? byPerson('notes', `SELECT person_id, kind, body, occurred_on, pinned, created_at
                       FROM person_note ORDER BY pinned DESC, created_at DESC`)
  : new Map();

const sources = (() => {
  const map = new Map();
  for (const row of all(`SELECT sl.entity_id AS person_id, s.kind, s.title, s.url, s.retrieved_at, s.note
                         FROM source_link sl JOIN source s ON s.id = sl.source_id
                         WHERE sl.entity_type = 'person'`)) {
    if (!ids.has(row.person_id)) continue;
    if (!map.has(row.person_id)) map.set(row.person_id, []);
    map.get(row.person_id).push(row);
  }
  return map;
})();

let people2 = people;
if (SUBSTANTIVE) {
  const hasRel = new Set(all(`SELECT from_person_id AS id FROM relationship
                              UNION SELECT to_person_id FROM relationship`).map(r => r.id));
  people2 = people.filter(p =>
    (areas.get(p.id) || []).length || (education.get(p.id) || []).length ||
    (affiliations.get(p.id) || []).length || (positions.get(p.id) || []).length ||
    hasRel.has(p.id) || p.short_bio || p.long_bio);
}
const droppedThin = people.length - people2.length;

const slugById = new Map(people2.map(p => [p.id, p.slug]));

const relationships = all(`
  SELECT r.from_person_id, r.to_person_id, r.type, rt.label, rt.inverse_code, rt.symmetric,
         rt.category, r.start_year, r.end_year, r.strength, r.verified, r.note,
         o.name AS organisation_name, i.name AS institution_name,
         COALESCE(c.short_name, c.name) AS court_name
  FROM relationship r
  JOIN relationship_type rt ON rt.code = r.type
  LEFT JOIN organisation o ON o.id = r.organisation_id
  LEFT JOIN institution  i ON i.id = r.institution_id
  LEFT JOIN court        c ON c.id = r.court_id`)
  .filter(r => slugById.has(r.from_person_id) && slugById.has(r.to_person_id))
  .map(r => ({
    from: slugById.get(r.from_person_id), to: slugById.get(r.to_person_id),
    type: r.type, label: r.label, inverse: r.inverse_code, symmetric: !!r.symmetric,
    category: r.category, start_year: r.start_year, end_year: r.end_year,
    strength: r.strength, verified: !!r.verified, note: r.note,
    context: [r.organisation_name, r.institution_name, r.court_name].filter(Boolean),
  }));

const inverseLabel = new Map(all(`SELECT code, label FROM relationship_type`).map(r => [r.code, r.label]));

const dataset = {
  meta: {
    title: TITLE,
    generated: new Date().toISOString().slice(0, 10),
    includes_notes: INCLUDE_NOTES,
    verified_only: VERIFIED_ONLY,
    counts: {
      people: people2.length,
      organisations: new Set([...affiliations.values()].flat().map(a => a.slug)).size,
      relationships: relationships.length,
    },
  },
  inverseLabels: Object.fromEntries(inverseLabel),
  people: people2.map(p => ({
    slug: p.slug, name: p.full_name, honorific: p.honorific,
    designation: p.designation, senior: !!p.is_senior_advocate, aor: !!p.is_aor,
    senior_year: p.senior_designated_year, aor_year: p.aor_year,
    status: p.status, city: p.base_city, state: p.base_state,
    batch: p.batch_year, since: p.first_year_of_practice, years: p.years_experience,
    enrolment: p.enrolment_number, enrolment_year: p.enrolment_year,
    bar_council: p.bar_council_name, fee_band: p.fee_band,
    verification: p.verification_status,
    interns: !!p.accepts_interns, intern_note: p.intern_intake_note,
    direct: p.accepts_direct_briefs, pro_bono: !!p.takes_pro_bono,
    legal_aid: !!p.legal_aid_panel, mentors: !!p.available_for_mentoring,
    headline: p.headline, short_bio: p.short_bio, long_bio: p.long_bio,
    areas: areas.get(p.id) || [], courts: courts.get(p.id) || [],
    languages: languages.get(p.id) || [], education: education.get(p.id) || [],
    affiliations: affiliations.get(p.id) || [], positions: positions.get(p.id) || [],
    clerkships: clerkships.get(p.id) || [], credentials: credentials.get(p.id) || [],
    publications: publications.get(p.id) || [], awards: awards.get(p.id) || [],
    contacts: contacts.get(p.id) || [], sources: sources.get(p.id) || [],
    notes: notes.get(p.id) || [],
  })),
  relationships,
};

// --- write ------------------------------------------------------------------

const css = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'src', 'static-app.js'), 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(TITLE)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>%E2%9A%96%EF%B8%8F</text></svg>">
<style>
${css}
${EXTRA_CSS}
</style>
</head>
<body>
<div id="app"></div>
<script id="dataset" type="application/json">${
  JSON.stringify(dataset).replace(/</g, '\\u003c')
}</script>
<script>
${client}
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Wrote ${path.relative(process.cwd(), OUT)}  (${kb} KB, one file, no dependencies)`);
console.log(`  people        ${dataset.meta.counts.people}`);
console.log(`  relationships ${dataset.meta.counts.relationships}`);
console.log(`  private notes ${INCLUDE_NOTES ? 'INCLUDED' : 'excluded'}`);
if (VERIFIED_ONLY) console.log(`  unverified records dropped`);
if (SUBSTANTIVE) console.log(`  bare roll entries dropped   ${droppedThin}`);

if (INCLUDE_NOTES) {
  console.log(`\n  !! This file contains your private notes in plain text.`);
  console.log(`     Anyone you send it to, or any host you upload it to, can read them.`);
}
const unverified = people2.filter(p => p.verification_status === 'unverified').length;
if (unverified && !VERIFIED_ONLY) {
  console.log(`\n  Note: ${unverified} of ${people2.length} records are marked "unverified" —`);
  console.log(`  facts taken from a personal list, not a checked source. They are labelled`);
  console.log(`  as such in the page. Use --verified-only to leave them out.`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
