// Assemble a complete advocate profile: every table that hangs off `person`.
import { all, one } from './db.js';

export function getProfile(slug, { includePrivateContacts = false, includeNotes = false } = {}) {
  const p = one(`SELECT * FROM v_person WHERE slug = ?`, [slug]);
  if (!p) return null;

  p.senior_designating_court = p.senior_designating_court_id
    ? one(`SELECT slug, name, short_name FROM court WHERE id = ?`, [p.senior_designating_court_id])
    : null;

  p.practice_areas = all(
    `SELECT pa.slug, pa.name, pa.description, ppa.emphasis, ppa.years_active, ppa.evidence_note,
            parent.name AS parent_name, parent.slug AS parent_slug
     FROM person_practice_area ppa
     JOIN practice_area pa ON pa.id = ppa.practice_area_id
     LEFT JOIN practice_area parent ON parent.id = pa.parent_id
     WHERE ppa.person_id = ?
     ORDER BY CASE ppa.emphasis WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END,
              pa.sort_order`, [p.id]);

  p.courts = all(
    `SELECT c.slug, c.name, c.short_name, c.court_type, c.city, c.requires_aor,
            pc.frequency, pc.since_year, pc.note
     FROM person_court pc JOIN court c ON c.id = pc.court_id
     WHERE pc.person_id = ?
     ORDER BY CASE pc.frequency WHEN 'primary' THEN 0 WHEN 'regular' THEN 1 ELSE 2 END,
              c.sort_order`, [p.id]);

  p.languages = all(
    `SELECT l.code, l.name, pl.proficiency
     FROM person_language pl JOIN language l ON l.code = pl.language_code
     WHERE pl.person_id = ? ORDER BY
       CASE pl.proficiency WHEN 'native' THEN 0 WHEN 'fluent' THEN 1 WHEN 'working' THEN 2 ELSE 3 END`,
    [p.id]);

  p.education = all(
    `SELECT pe.*, i.slug AS institution_slug, i.name AS institution_name, i.short_name AS institution_short
     FROM person_education pe JOIN institution i ON i.id = pe.institution_id
     WHERE pe.person_id = ? ORDER BY pe.end_year DESC NULLS LAST`, [p.id]);

  p.affiliations = all(
    `SELECT pa.*, o.slug AS organisation_slug, o.name AS organisation_name, o.type AS organisation_type
     FROM person_affiliation pa JOIN organisation o ON o.id = pa.organisation_id
     WHERE pa.person_id = ?
     ORDER BY pa.is_current DESC, pa.start_year DESC NULLS LAST`, [p.id]);

  p.positions = all(
    `SELECT pp.*, c.name AS court_name, c.slug AS court_slug
     FROM person_position pp LEFT JOIN court c ON c.id = pp.court_id
     WHERE pp.person_id = ? ORDER BY pp.start_year DESC NULLS LAST`, [p.id]);

  p.clerkships = all(
    `SELECT pc.*, j.full_name AS judge_full_name, j.slug AS judge_slug, j.honorific AS judge_honorific,
            c.name AS court_name, c.slug AS court_slug
     FROM person_clerkship pc
     LEFT JOIN person j ON j.id = pc.judge_person_id
     LEFT JOIN court c ON c.id = pc.court_id
     WHERE pc.person_id = ? ORDER BY pc.start_year DESC NULLS LAST`, [p.id]);

  p.credentials   = all(`SELECT * FROM person_credential  WHERE person_id = ? ORDER BY year DESC NULLS LAST`, [p.id]);
  p.publications  = all(`SELECT * FROM person_publication WHERE person_id = ? ORDER BY year DESC NULLS LAST`, [p.id]);
  p.awards        = all(`SELECT * FROM person_award       WHERE person_id = ? ORDER BY year DESC NULLS LAST`, [p.id]);

  p.contacts = all(
    `SELECT id, kind, label, value, is_public FROM person_contact
     WHERE person_id = ? ${includePrivateContacts ? '' : 'AND is_public = 1'} ORDER BY kind`, [p.id]);

  p.matters = all(
    `SELECT m.*, pm.role, pm.side, c.short_name AS court_short, c.name AS court_name
     FROM person_matter pm JOIN matter m ON m.id = pm.matter_id
     LEFT JOIN court c ON c.id = m.court_id
     WHERE pm.person_id = ? ORDER BY m.year DESC NULLS LAST`, [p.id]);

  // Private notes are opt-in and never leave the HTML layer — the JSON API
  // calls getProfile() without this flag, so notes cannot leak through it.
  p.notes = includeNotes
    ? all(`SELECT id, kind, body, occurred_on, pinned, created_at, updated_at
           FROM person_note WHERE person_id = ?
           ORDER BY pinned DESC, COALESCE(occurred_on, created_at) DESC, id DESC`, [p.id])
    : [];

  p.relationships = relationshipsFor(p.id);

  p.sources = all(
    `SELECT s.* FROM source_link sl JOIN source s ON s.id = sl.source_id
     WHERE sl.entity_type = 'person' AND sl.entity_id = ?`, [p.id]);

  return p;
}

/**
 * All edges touching this person, normalised so that the person is always the
 * subject. An edge stored as `A chamber_junior_of B` is returned to B as
 * `mentor_of A`, using relationship_type.inverse_code.
 */
export function relationshipsFor(personId) {
  const outgoing = all(
    `SELECT r.*, rt.label, rt.category, 'out' AS direction,
            q.slug AS other_slug, q.full_name AS other_name, q.honorific AS other_honorific,
            q.designation AS other_designation, q.headline AS other_headline,
            o.name AS organisation_name, o.slug AS organisation_slug,
            i.name AS institution_name, c.short_name AS court_short, c.name AS court_name
     FROM relationship r
     JOIN relationship_type rt ON rt.code = r.type
     JOIN person q ON q.id = r.to_person_id
     LEFT JOIN organisation o ON o.id = r.organisation_id
     LEFT JOIN institution  i ON i.id = r.institution_id
     LEFT JOIN court        c ON c.id = r.court_id
     WHERE r.from_person_id = ? AND q.visibility = 'public'`, [personId]);

  const incoming = all(
    `SELECT r.*, COALESCE(inv.label, rt.label) AS label, rt.category, 'in' AS direction,
            COALESCE(rt.inverse_code, rt.code) AS effective_type,
            q.slug AS other_slug, q.full_name AS other_name, q.honorific AS other_honorific,
            q.designation AS other_designation, q.headline AS other_headline,
            o.name AS organisation_name, o.slug AS organisation_slug,
            i.name AS institution_name, c.short_name AS court_short, c.name AS court_name
     FROM relationship r
     JOIN relationship_type rt ON rt.code = r.type
     LEFT JOIN relationship_type inv ON inv.code = rt.inverse_code
     JOIN person q ON q.id = r.from_person_id
     LEFT JOIN organisation o ON o.id = r.organisation_id
     LEFT JOIN institution  i ON i.id = r.institution_id
     LEFT JOIN court        c ON c.id = r.court_id
     WHERE r.to_person_id = ? AND q.visibility = 'public'
       AND NOT (rt.symmetric = 1 AND r.from_person_id = ?)`, [personId, personId]);

  // A symmetric edge stored once should appear once, from either side.
  const edges = [...outgoing, ...incoming].map(e => ({
    ...e,
    type: e.effective_type || e.type,
  }));

  const byCategory = {};
  for (const e of edges) (byCategory[e.category] ||= []).push(e);
  return { edges, byCategory };
}

/** Nodes + edges for the network view, expanded N hops from a root advocate. */
export function networkGraph(slug, depth = 2, limit = 120) {
  const root = one(`SELECT id, slug, full_name FROM person WHERE slug = ?`, [slug]);
  if (!root) return null;

  const reached = all(
    `WITH RECURSIVE reach(person_id, depth) AS (
       SELECT ?, 0
       UNION
       SELECT CASE WHEN r.from_person_id = k.person_id THEN r.to_person_id
                   ELSE r.from_person_id END, k.depth + 1
       FROM relationship r
       JOIN reach k ON k.person_id IN (r.from_person_id, r.to_person_id)
       WHERE k.depth < ?
     )
     SELECT person_id, MIN(depth) AS depth FROM reach GROUP BY person_id LIMIT ?`,
    [root.id, depth, limit]);

  const ids = reached.map(r => r.person_id);
  if (!ids.length) return { root: root.slug, nodes: [], edges: [] };
  const ph = ids.map(() => '?').join(',');

  const depthById = new Map(reached.map(r => [r.person_id, r.depth]));

  const nodes = all(
    `SELECT id, slug, full_name, honorific, designation, is_senior_advocate, is_aor,
            base_city, headline, first_year_of_practice
     FROM person WHERE id IN (${ph}) AND visibility = 'public'`, ids)
    .map(n => ({ ...n, depth: depthById.get(n.id) ?? 0 }));

  const nodeIds = new Set(nodes.map(n => n.id));

  const edges = all(
    `SELECT r.id, r.from_person_id AS source, r.to_person_id AS target, r.type,
            rt.label, rt.category, r.strength, r.start_year, r.end_year,
            o.name AS organisation_name
     FROM relationship r
     JOIN relationship_type rt ON rt.code = r.type
     LEFT JOIN organisation o ON o.id = r.organisation_id
     WHERE r.from_person_id IN (${ph}) AND r.to_person_id IN (${ph})`,
    [...ids, ...ids]).filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  return { root: root.slug, depth, nodes, edges };
}
