#!/usr/bin/env node
// ============================================================================
// Bulk import from a JSON file. Idempotent on `slug`: re-running updates
// existing records rather than duplicating them.
//
//   node scripts/import-json.js data/sample.json
//   node scripts/import-json.js data/sample.json --source-kind=bar_council_roll
//   node scripts/import-json.js data/overlay.json --merge
//
// MERGE MODE. Normally a file owns the people it names: every scalar is set and
// every child collection is replaced, so the file is the record of truth. That
// is wrong for a file that only carries part of a record — a cause-list
// derivation says nothing but "this person was listed in the Supreme Court N
// times", and importing it normally would blank their name and delete their
// practice areas. With --merge (or "_merge": true in the file), only the fields
// and collections the record actually contains are touched. Derived overlays
// declare it themselves so that `npm run build` does the right thing.
//
// See docs/DATA-DICTIONARY.md for the record shape.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { getDb, all, one, run, idBySlug, ROOT } from '../src/db.js';

const file = process.argv[2] || path.join(ROOT, 'data', 'sample.json');
const sourceKindArg = process.argv.find(a => a.startsWith('--source-kind='));
const DEFAULT_SOURCE_KIND = sourceKindArg ? sourceKindArg.split('=')[1] : 'manual_entry';

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const MERGE = process.argv.includes('--merge') || data._merge === true;
const db = getDb();

const stats = { organisations: 0, people: 0, relationships: 0, matters: 0, skipped: [] };

db.exec('BEGIN');
try {
  importOrganisations(data.organisations || []);
  for (const p of data.people || []) importPerson(p);
  // Chamber heads are people, so the FK is resolved on a second pass.
  linkOrganisationHeads(data.organisations || []);
  for (const r of data.relationships || []) importRelationship(r);
  for (const m of data.matters || []) importMatter(m);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Import failed, rolled back:', err.message);
  process.exit(1);
}

console.log(`Imported from ${path.relative(ROOT, file)}:`);
console.log(`  organisations ${stats.organisations}`);
console.log(`  people        ${stats.people}`);
console.log(`  relationships ${stats.relationships}`);
console.log(`  matters       ${stats.matters}`);
if (stats.skipped.length) console.log(`  skipped       ${stats.skipped.length}`, stats.skipped);

// ---------------------------------------------------------------------------

function upsert(table, slug, columns) {
  const existing = one(`SELECT id FROM ${table} WHERE slug = ?`, [slug]);
  const keys = Object.keys(columns);
  if (existing) {
    if (keys.length) {
      run(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...keys.map(k => columns[k]), existing.id]);
    }
    return existing.id;
  }
  const res = run(
    `INSERT INTO ${table} (slug${keys.length ? ', ' + keys.join(', ') : ''})
     VALUES (?${keys.length ? ', ' + keys.map(() => '?').join(', ') : ''})`,
    [slug, ...keys.map(k => columns[k])]);
  return Number(res.lastInsertRowid);
}

function bool(v) { return v ? 1 : 0; }

function importOrganisations(orgs) {
  for (const o of orgs) {
    upsert('organisation', o.slug, {
      name: o.name, type: o.type, city: o.city ?? null, state: o.state ?? null,
      website: o.website ?? null, founded_year: o.founded_year ?? null,
      size_band: o.size_band ?? null, description: o.description ?? null,
    });
    stats.organisations++;
  }
}

function linkOrganisationHeads(orgs) {
  for (const o of orgs) {
    if (!o.head_person) continue;
    const head = one(`SELECT id FROM person WHERE slug = ?`, [o.head_person]);
    if (head) run(`UPDATE organisation SET head_person_id = ? WHERE slug = ?`, [head.id, o.slug]);
  }
}

function importPerson(p) {
  // A merge overlay describes people who should already exist. If one does not,
  // there is no name to insert — say so rather than failing on NOT NULL.
  if (MERGE && !p.full_name && !one(`SELECT id FROM person WHERE slug = ?`, [p.slug])) {
    stats.skipped.push(`person ${p.slug} (merge overlay, not already in the directory)`);
    return;
  }

  // In merge mode a column is only written when the record actually carries it.
  // `first_year_of_practice` and the two designation-derived booleans have more
  // than one source key, so presence is tested against all of them.
  const has = (...keys) => !MERGE || keys.some(k => p[k] !== undefined);
  const only = obj => MERGE
    ? Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
    : obj;

  const personId = upsert('person', p.slug, only({
    full_name: has('full_name') ? p.full_name : undefined,
    preferred_name: p.preferred_name ?? (MERGE ? undefined : null),
    honorific: p.honorific ?? (MERGE ? undefined : null),
    pronouns: p.pronouns ?? (MERGE ? undefined : null),
    designation: has('designation') ? (p.designation ?? 'advocate') : undefined,
    is_senior_advocate: has('is_senior_advocate', 'designation') ? bool(p.is_senior_advocate ?? p.designation === 'senior_advocate') : undefined,
    senior_designated_year: p.senior_designated_year ?? (MERGE ? undefined : null),
    senior_designating_court_id: p.senior_designating_court ? idBySlug('court', p.senior_designating_court) : (MERGE ? undefined : null),
    is_aor: has('is_aor', 'designation') ? bool(p.is_aor ?? ['advocate_on_record', 'senior_advocate_aor'].includes(p.designation)) : undefined,
    aor_year: p.aor_year ?? (MERGE ? undefined : null),
    aor_code: p.aor_code ?? (MERGE ? undefined : null),
    bar_council_id: p.bar_council ? idBySlug('bar_council', p.bar_council) : (MERGE ? undefined : null),
    enrolment_number: p.enrolment_number ?? (MERGE ? undefined : null),
    enrolment_year: p.enrolment_year ?? (MERGE ? undefined : null),
    first_year_of_practice: has('first_year_of_practice', 'enrolment_year') ? (p.first_year_of_practice ?? p.enrolment_year ?? null) : undefined,
    class_of: p.class_of ?? (MERGE ? undefined : null),
    status: has('status') ? (p.status ?? 'practising') : undefined,
    primary_court_id: p.primary_court ? idBySlug('court', p.primary_court) : (MERGE ? undefined : null),
    primary_organisation_id: p.primary_organisation ? idBySlug('organisation', p.primary_organisation) : (MERGE ? undefined : null),
    base_city: p.base_city ?? (MERGE ? undefined : null),
    base_state: p.base_state ?? (MERGE ? undefined : null),
    country: has('country') ? (p.country ?? 'India') : undefined,
    headline: p.headline ?? (MERGE ? undefined : null),
    short_bio: p.short_bio ?? (MERGE ? undefined : null),
    long_bio: p.long_bio ?? (MERGE ? undefined : null),
    photo_url: p.photo_url ?? (MERGE ? undefined : null),
    accepts_interns: has('accepts_interns') ? bool(p.accepts_interns) : undefined,
    intern_intake_note: p.intern_intake_note ?? (MERGE ? undefined : null),
    // Tri-state: true / false / unknown. SQLite will not bind a JS boolean, so
    // coerce here rather than making every import file write 1 and 0.
    accepts_direct_briefs: p.accepts_direct_briefs == null ? (MERGE ? undefined : null) : bool(p.accepts_direct_briefs),
    takes_pro_bono: has('takes_pro_bono') ? bool(p.takes_pro_bono) : undefined,
    legal_aid_panel: has('legal_aid_panel') ? bool(p.legal_aid_panel) : undefined,
    fee_band: p.fee_band ?? (MERGE ? undefined : null),
    available_for_mentoring: has('available_for_mentoring') ? bool(p.available_for_mentoring) : undefined,
    verification_status: has('verification_status') ? (p.verification_status ?? 'unverified') : undefined,
    visibility: has('visibility') ? (p.visibility ?? 'public') : undefined,
    updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  }));
  stats.people++;

  // Child rows are replaced wholesale — the source file is the record of truth.
  const wipe = t => run(`DELETE FROM ${t} WHERE person_id = ?`, [personId]);
  const OWNS = {
    person_practice_area: 'practice_areas', person_court: 'courts',
    person_language: 'languages', person_education: 'education',
    person_affiliation: 'affiliations', person_position: 'positions',
    person_clerkship: 'clerkships', person_credential: 'credentials',
    person_publication: 'publications', person_award: 'awards',
    person_contact: 'contacts',
  };
  // In merge mode a collection is only replaced when the record carries it, so
  // an overlay that supplies courts cannot delete someone's practice areas.
  for (const [table, key] of Object.entries(OWNS)) {
    if (!MERGE || p[key] !== undefined) wipe(table);
  }
  // person_note is deliberately NOT wiped — those are the owner's own words and
  // must survive a re-import. Imported notes are deduplicated on body instead.

  for (const a of p.practice_areas || []) {
    run(`INSERT OR REPLACE INTO person_practice_area
         (person_id, practice_area_id, emphasis, years_active, evidence_note) VALUES (?,?,?,?,?)`,
        [personId, idBySlug('practice_area', a.slug), a.emphasis || 'secondary',
         a.years_active ?? null, a.evidence_note ?? null]);
  }

  for (const c of p.courts || []) {
    run(`INSERT OR REPLACE INTO person_court (person_id, court_id, frequency, since_year, note)
         VALUES (?,?,?,?,?)`,
        [personId, idBySlug('court', c.slug), c.frequency || 'regular', c.since_year ?? null, c.note ?? null]);
  }

  for (const l of p.languages || []) {
    run(`INSERT OR REPLACE INTO person_language (person_id, language_code, proficiency) VALUES (?,?,?)`,
        [personId, l.code, l.proficiency ?? null]);
  }

  for (const e of p.education || []) {
    run(`INSERT INTO person_education (person_id, institution_id, degree, field, start_year, end_year, distinction)
         VALUES (?,?,?,?,?,?,?)`,
        [personId, idBySlug('institution', e.institution), e.degree ?? null, e.field ?? null,
         e.start_year ?? null, e.end_year ?? null, e.distinction ?? null]);
  }

  for (const a of p.affiliations || []) {
    run(`INSERT INTO person_affiliation (person_id, organisation_id, role, start_year, end_year, is_current, note)
         VALUES (?,?,?,?,?,?,?)`,
        [personId, idBySlug('organisation', a.organisation), a.role, a.start_year ?? null,
         a.end_year ?? null, bool(a.is_current), a.note ?? null]);
  }

  for (const pos of p.positions || []) {
    run(`INSERT INTO person_position (person_id, title, body, court_id, start_year, end_year, note)
         VALUES (?,?,?,?,?,?,?)`,
        [personId, pos.title, pos.body ?? null, pos.court ? idBySlug('court', pos.court) : null,
         pos.start_year ?? null, pos.end_year ?? null, pos.note ?? null]);
  }

  for (const ck of p.clerkships || []) {
    const judge = ck.judge_person ? one(`SELECT id FROM person WHERE slug = ?`, [ck.judge_person]) : null;
    run(`INSERT INTO person_clerkship (person_id, judge_person_id, judge_name, court_id, start_year, end_year)
         VALUES (?,?,?,?,?,?)`,
        [personId, judge?.id ?? null, ck.judge_name ?? null,
         ck.court ? idBySlug('court', ck.court) : null, ck.start_year ?? null, ck.end_year ?? null]);
  }

  for (const c of p.credentials || []) {
    run(`INSERT INTO person_credential (person_id, kind, name, issuer, year) VALUES (?,?,?,?,?)`,
        [personId, c.kind ?? 'other', c.name, c.issuer ?? null, c.year ?? null]);
  }
  for (const pub of p.publications || []) {
    run(`INSERT INTO person_publication (person_id, title, venue, year, url) VALUES (?,?,?,?,?)`,
        [personId, pub.title, pub.venue ?? null, pub.year ?? null, pub.url ?? null]);
  }
  for (const aw of p.awards || []) {
    run(`INSERT INTO person_award (person_id, name, awarded_by, year) VALUES (?,?,?,?)`,
        [personId, aw.name, aw.awarded_by ?? null, aw.year ?? null]);
  }
  for (const c of p.contacts || []) {
    run(`INSERT INTO person_contact (person_id, kind, label, value, is_public) VALUES (?,?,?,?,?)`,
        [personId, c.kind, c.label ?? null, c.value, bool(c.is_public)]);
  }

  for (const n of p.notes || []) {
    const body = typeof n === 'string' ? n : n.body;
    if (!body) continue;
    const dupe = one(`SELECT id FROM person_note WHERE person_id = ? AND body = ?`, [personId, body]);
    if (dupe) continue;
    run(`INSERT INTO person_note (person_id, kind, body, occurred_on, is_private, pinned)
         VALUES (?,?,?,?,?,?)`,
        [personId, (typeof n === 'object' && n.kind) || 'note', body,
         (typeof n === 'object' && n.occurred_on) || null,
         typeof n === 'object' && n.is_private === false ? 0 : 1,
         bool(typeof n === 'object' && n.pinned)]);
  }

  // Provenance. Every imported record gets at least one source row.
  const sources = p.sources?.length ? p.sources
    : MERGE ? [] : [{ kind: DEFAULT_SOURCE_KIND, title: `Import: ${path.basename(file)}` }];
  // Drop the previous import's sources for this person so re-running does not
  // accumulate duplicates. Sources shared with another entity are left alone.
  // An overlay adds provenance; it does not get to remove the provenance behind
  // facts it never touched.
  const stale = MERGE ? [] : all(`SELECT source_id FROM source_link WHERE entity_type = 'person' AND entity_id = ?`, [personId]);
  if (!MERGE) run(`DELETE FROM source_link WHERE entity_type = 'person' AND entity_id = ?`, [personId]);
  for (const { source_id } of stale) {
    run(`DELETE FROM source WHERE id = ? AND NOT EXISTS (SELECT 1 FROM source_link WHERE source_id = ?)`,
        [source_id, source_id]);
  }
  for (const s of sources) {
    const res = run(`INSERT INTO source (kind, title, url, retrieved_at, note) VALUES (?,?,?,?,?)`,
      [s.kind || DEFAULT_SOURCE_KIND, s.title ?? null, s.url ?? null,
       s.retrieved_at ?? null, s.note ?? null]);
    run(`INSERT INTO source_link (source_id, entity_type, entity_id, field) VALUES (?,?,?,?)`,
      [Number(res.lastInsertRowid), 'person', personId, s.field ?? null]);
  }
}

function importRelationship(r) {
  const from = one(`SELECT id FROM person WHERE slug = ?`, [r.from]);
  const to   = one(`SELECT id FROM person WHERE slug = ?`, [r.to]);
  if (!from || !to) { stats.skipped.push(`relationship ${r.from} -> ${r.to} (unknown person)`); return; }
  const type = one(`SELECT code FROM relationship_type WHERE code = ?`, [r.type]);
  if (!type) { stats.skipped.push(`relationship type "${r.type}"`); return; }

  run(`INSERT OR REPLACE INTO relationship
       (from_person_id, to_person_id, type, organisation_id, institution_id, court_id,
        start_year, end_year, strength, verified, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [from.id, to.id, r.type,
       r.organisation ? idBySlug('organisation', r.organisation) : null,
       r.institution  ? idBySlug('institution',  r.institution)  : null,
       r.court        ? idBySlug('court',        r.court)        : null,
       r.start_year ?? null, r.end_year ?? null, r.strength ?? 3, bool(r.verified), r.note ?? null]);
  stats.relationships++;
}

function importMatter(m) {
  const existing = one(`SELECT id FROM matter WHERE title = ? AND IFNULL(year,0) = IFNULL(?,0)`, [m.title, m.year ?? null]);
  let matterId = existing?.id;
  if (!matterId) {
    const res = run(`INSERT INTO matter (title, citation, court_id, year, practice_area_id, outcome, summary, url)
                     VALUES (?,?,?,?,?,?,?,?)`,
      [m.title, m.citation ?? null, m.court ? idBySlug('court', m.court) : null, m.year ?? null,
       m.practice_area ? idBySlug('practice_area', m.practice_area) : null,
       m.outcome ?? null, m.summary ?? null, m.url ?? null]);
    matterId = Number(res.lastInsertRowid);
  }
  run(`DELETE FROM person_matter WHERE matter_id = ?`, [matterId]);
  for (const c of m.counsel || []) {
    const person = one(`SELECT id FROM person WHERE slug = ?`, [c.person]);
    if (!person) { stats.skipped.push(`counsel ${c.person} on ${m.title}`); continue; }
    run(`INSERT OR REPLACE INTO person_matter (person_id, matter_id, role, side) VALUES (?,?,?,?)`,
        [person.id, matterId, c.role ?? 'other', c.side ?? null]);
  }
  stats.matters++;
}
