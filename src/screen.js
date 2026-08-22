// ============================================================================
// The screener engine.
//
// One function, `screen(filters)`, takes a plain filter object and returns
// matching advocates. Every audience lens in Phases 2-4 is a preset filter
// object plus a different renderer — never a fork of this file.
//
// Filters are composable and all optional:
//
//   q                      free-text over name / headline / bio (FTS5)
//   practice_areas         [slug]   matches the area and its sub-areas
//   practice_area_mode     'any' (default) | 'all'
//   emphasis               ['primary','secondary','occasional'] restrict the match
//   courts                 [slug]   matches the court and its benches
//   court_mode             'any' (default) | 'all'
//   court_frequency        ['primary','regular','occasional']
//   designation            [code]
//   is_senior_advocate     bool
//   is_aor                 bool
//   status                 [code]                  default: exclude deceased
//   min_years / max_years  years since first year of practice
//   city / state           exact match
//   languages              [code]
//   language_mode          'any' (default) | 'all'
//   institutions           [slug]   studied at
//   organisations          [slug]   affiliated with, ever
//   bar_councils           [slug]
//   accepts_interns        bool     (Phase 2 lens)
//   accepts_direct_briefs  bool     (Phase 4 lens)
//   takes_pro_bono         bool
//   legal_aid_panel        bool
//   available_for_mentoring bool
//   fee_band               [code]
//   verification_status    [code]
//   batch_year             [int]    graduating batch (class of)
//   batch_from / batch_to  int      batch range
//   has_notes              bool     only people I have written a note about
//   note_q                 string   free text across my private notes
//   relationship_types     [code]   has at least one edge of this type
//   missing                [field]  thin records: practice_areas, courts, class_of, city
//   chamber_lineage_of     slug     everyone who juniored under this advocate
//   lineage_depth          1-4      how many chamber generations down (default 3)
//   connected_to           slug     within N degrees in the relationship graph
//   connection_depth       1-3      (default 2)
//   sort                   see SORTS
//   limit / offset
// ============================================================================

import { all, one } from './db.js';

const SORTS = {
  relevance:      'p.full_name COLLATE NOCASE ASC',
  name_asc:       'p.full_name COLLATE NOCASE ASC',
  name_desc:      'p.full_name COLLATE NOCASE DESC',
  experience_desc:'p.first_year_of_practice ASC NULLS LAST, p.full_name COLLATE NOCASE ASC',
  experience_asc: 'p.first_year_of_practice DESC NULLS LAST, p.full_name COLLATE NOCASE ASC',
  seniority:      'p.is_senior_advocate DESC, p.is_aor DESC, p.first_year_of_practice ASC NULLS LAST',
  recently_updated:'p.updated_at DESC',
  batch_asc:      'p.batch_year ASC NULLS LAST, p.full_name COLLATE NOCASE ASC',
  batch_desc:     'p.batch_year DESC NULLS LAST, p.full_name COLLATE NOCASE ASC',
  notes_desc:     'p.note_count DESC, p.full_name COLLATE NOCASE ASC',
};

export const SORT_LABELS = {
  seniority: 'Seniority', experience_desc: 'Most experienced',
  experience_asc: 'Least experienced', name_asc: 'Name (A–Z)', name_desc: 'Name (Z–A)',
  batch_desc: 'Batch (newest)', batch_asc: 'Batch (oldest)',
  notes_desc: 'Most noted', recently_updated: 'Recently updated',
};

/** Fields a record can be "missing", for finding thin entries. */
const MISSING_CLAUSES = {
  practice_areas: `NOT EXISTS (SELECT 1 FROM person_practice_area x WHERE x.person_id = p.id)`,
  courts:         `NOT EXISTS (SELECT 1 FROM person_court x WHERE x.person_id = p.id)`,
  education:      `NOT EXISTS (SELECT 1 FROM person_education x WHERE x.person_id = p.id)`,
  relationships:  `NOT EXISTS (SELECT 1 FROM relationship r WHERE r.from_person_id = p.id OR r.to_person_id = p.id)`,
  notes:          `p.note_count = 0`,
  class_of:       `p.batch_year IS NULL`,
  city:           `p.base_city IS NULL`,
  headline:       `p.headline IS NULL`,
};

const BOOL_COLUMNS = [
  'accepts_interns', 'accepts_direct_briefs', 'takes_pro_bono',
  'legal_aid_panel', 'available_for_mentoring', 'is_senior_advocate', 'is_aor',
];

const LIST_COLUMNS = {
  designation: 'designation',
  status: 'status',
  fee_band: 'fee_band',
  verification_status: 'verification_status',
};

// --- taxonomy expansion -----------------------------------------------------

/** A practice area slug plus every descendant id. */
function practiceAreaSubtree(slug) {
  return all(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM practice_area WHERE slug = ?
       UNION
       SELECT pa.id FROM practice_area pa JOIN sub ON pa.parent_id = sub.id
     ) SELECT id FROM sub`, [slug]).map(r => r.id);
}

/** A court slug plus its benches. */
function courtSubtree(slug) {
  return all(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM court WHERE slug = ?
       UNION
       SELECT c.id FROM court c JOIN sub ON c.parent_id = sub.id
     ) SELECT id FROM sub`, [slug]).map(r => r.id);
}

/**
 * Everyone who juniored in this advocate's chamber, transitively.
 * The second generation matters: a student asking "who came out of the
 * Raghunathan chamber" wants Barucha *and* the people Barucha now trains.
 */
export function chamberLineage(slug, depth = 3) {
  return all(
    `WITH RECURSIVE lineage(person_id, depth) AS (
       SELECT id, 0 FROM person WHERE slug = ?
       UNION
       SELECT r.from_person_id, l.depth + 1
       FROM relationship r
       JOIN lineage l ON r.to_person_id = l.person_id
       WHERE r.type IN ('chamber_junior_of','former_chamber_junior_of')
         AND l.depth < ?
     )
     SELECT person_id, MIN(depth) AS depth FROM lineage GROUP BY person_id`,
    [slug, depth]);
}

/** Everyone within N degrees of this advocate, following edges in either direction. */
export function connectedWithin(slug, depth = 2) {
  return all(
    `WITH RECURSIVE reach(person_id, depth) AS (
       SELECT id, 0 FROM person WHERE slug = ?
       UNION
       SELECT CASE WHEN r.from_person_id = k.person_id THEN r.to_person_id
                   ELSE r.from_person_id END,
              k.depth + 1
       FROM relationship r
       JOIN reach k ON k.person_id IN (r.from_person_id, r.to_person_id)
       WHERE k.depth < ?
     )
     SELECT person_id, MIN(depth) AS depth FROM reach GROUP BY person_id`,
    [slug, depth]);
}

// --- the query builder ------------------------------------------------------

function buildWhere(f) {
  const where = [];
  const params = [];
  const push = (sql, ...p) => { where.push(sql); params.push(...p); };
  const list = v => (Array.isArray(v) ? v : [v]).filter(x => x !== '' && x != null);
  const placeholders = n => Array(n).fill('?').join(',');

  if (f.visibility !== 'any') push(`p.visibility = 'public'`);

  if (f.q) {
    // FTS5 prefix match on each token, so "raghu const" works.
    const query = String(f.q).trim().split(/\s+/)
      .map(t => t.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean).map(t => `${t}*`).join(' ');
    if (query) push(`p.id IN (SELECT rowid FROM person_fts WHERE person_fts MATCH ?)`, query);
  }

  for (const col of BOOL_COLUMNS) {
    if (f[col] === true || f[col] === 'true' || f[col] === 1) push(`p.${col} = 1`);
    else if (f[col] === false || f[col] === 'false') push(`p.${col} = 0`);
  }

  for (const [key, col] of Object.entries(LIST_COLUMNS)) {
    const vals = list(f[key] ?? []);
    if (vals.length) push(`p.${col} IN (${placeholders(vals.length)})`, ...vals);
  }
  // Default: hide deceased entries unless explicitly asked for.
  if (!list(f.status ?? []).length) push(`p.status <> 'deceased'`);

  // --- practice areas -------------------------------------------------------
  const areas = list(f.practice_areas ?? []);
  if (areas.length) {
    const emphasis = list(f.emphasis ?? []);
    const clauseFor = slug => {
      const ids = practiceAreaSubtree(slug);
      if (!ids.length) return { sql: '0', params: [] };
      let sql = `EXISTS (SELECT 1 FROM person_practice_area ppa
                         WHERE ppa.person_id = p.id
                           AND ppa.practice_area_id IN (${placeholders(ids.length)})`;
      const ps = [...ids];
      if (emphasis.length) {
        sql += ` AND ppa.emphasis IN (${placeholders(emphasis.length)})`;
        ps.push(...emphasis);
      }
      return { sql: sql + ')', params: ps };
    };
    const clauses = areas.map(clauseFor);
    const joiner = f.practice_area_mode === 'all' ? ' AND ' : ' OR ';
    push('(' + clauses.map(c => c.sql).join(joiner) + ')', ...clauses.flatMap(c => c.params));
  }

  // --- courts ---------------------------------------------------------------
  const courts = list(f.courts ?? []);
  if (courts.length) {
    const freq = list(f.court_frequency ?? []);
    const clauseFor = slug => {
      const ids = courtSubtree(slug);
      if (!ids.length) return { sql: '0', params: [] };
      let sql = `EXISTS (SELECT 1 FROM person_court pc
                         WHERE pc.person_id = p.id
                           AND pc.court_id IN (${placeholders(ids.length)})`;
      const ps = [...ids];
      if (freq.length) {
        sql += ` AND pc.frequency IN (${placeholders(freq.length)})`;
        ps.push(...freq);
      }
      return { sql: sql + ')', params: ps };
    };
    const clauses = courts.map(clauseFor);
    const joiner = f.court_mode === 'all' ? ' AND ' : ' OR ';
    push('(' + clauses.map(c => c.sql).join(joiner) + ')', ...clauses.flatMap(c => c.params));
  }

  // --- languages ------------------------------------------------------------
  const langs = list(f.languages ?? []);
  if (langs.length) {
    if (f.language_mode === 'all') {
      for (const code of langs) {
        push(`EXISTS (SELECT 1 FROM person_language pl WHERE pl.person_id = p.id AND pl.language_code = ?)`, code);
      }
    } else {
      push(`EXISTS (SELECT 1 FROM person_language pl WHERE pl.person_id = p.id
                    AND pl.language_code IN (${placeholders(langs.length)}))`, ...langs);
    }
  }

  // --- institutions / organisations / bar councils --------------------------
  const insts = list(f.institutions ?? []);
  if (insts.length) {
    push(`EXISTS (SELECT 1 FROM person_education pe JOIN institution i ON i.id = pe.institution_id
                  WHERE pe.person_id = p.id AND i.slug IN (${placeholders(insts.length)}))`, ...insts);
  }

  const orgs = list(f.organisations ?? []);
  if (orgs.length) {
    push(`EXISTS (SELECT 1 FROM person_affiliation pa JOIN organisation o ON o.id = pa.organisation_id
                  WHERE pa.person_id = p.id AND o.slug IN (${placeholders(orgs.length)}))`, ...orgs);
  }

  const councils = list(f.bar_councils ?? []);
  if (councils.length) {
    push(`p.bar_council_id IN (SELECT id FROM bar_council WHERE slug IN (${placeholders(councils.length)}))`, ...councils);
  }

  // --- experience & geography ----------------------------------------------
  if (f.min_years) push(`p.first_year_of_practice IS NOT NULL
                         AND CAST(strftime('%Y','now') AS INTEGER) - p.first_year_of_practice >= ?`, Number(f.min_years));
  if (f.max_years) push(`p.first_year_of_practice IS NOT NULL
                         AND CAST(strftime('%Y','now') AS INTEGER) - p.first_year_of_practice <= ?`, Number(f.max_years));
  if (f.city)  push(`p.base_city = ?`, f.city);
  if (f.state) push(`p.base_state = ?`, f.state);

  // --- batch (class of) -----------------------------------------------------
  const batches = list(f.batch_year ?? []).map(Number).filter(Number.isFinite);
  if (batches.length) push(`p.batch_year IN (${placeholders(batches.length)})`, ...batches);
  if (f.batch_from) push(`p.batch_year >= ?`, Number(f.batch_from));
  if (f.batch_to)   push(`p.batch_year <= ?`, Number(f.batch_to));

  // --- my notes -------------------------------------------------------------
  if (f.has_notes === true || f.has_notes === 'true') push(`p.note_count > 0`);
  else if (f.has_notes === false || f.has_notes === 'false') push(`p.note_count = 0`);

  if (f.note_q) {
    const q = String(f.note_q).trim().split(/\s+/)
      .map(t => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).map(t => `${t}*`).join(' ');
    if (q) push(`EXISTS (SELECT 1 FROM person_note pn
                         WHERE pn.person_id = p.id
                           AND pn.id IN (SELECT rowid FROM person_note_fts WHERE person_note_fts MATCH ?))`, q);
  }

  // --- relationship presence ------------------------------------------------
  const relTypes = list(f.relationship_types ?? []);
  if (relTypes.length) {
    push(`EXISTS (SELECT 1 FROM relationship r
                  WHERE (r.from_person_id = p.id OR r.to_person_id = p.id)
                    AND r.type IN (${placeholders(relTypes.length)}))`, ...relTypes);
  }
  const relCats = list(f.relationship_categories ?? []);
  if (relCats.length) {
    push(`EXISTS (SELECT 1 FROM relationship r JOIN relationship_type rt ON rt.code = r.type
                  WHERE (r.from_person_id = p.id OR r.to_person_id = p.id)
                    AND rt.category IN (${placeholders(relCats.length)}))`, ...relCats);
  }

  // --- thin records ---------------------------------------------------------
  for (const field of list(f.missing ?? [])) {
    if (MISSING_CLAUSES[field]) push(MISSING_CLAUSES[field]);
  }

  // --- graph filters --------------------------------------------------------
  if (f.chamber_lineage_of) {
    const ids = chamberLineage(f.chamber_lineage_of, Number(f.lineage_depth) || 3)
      .filter(r => r.depth > 0).map(r => r.person_id);
    push(ids.length ? `p.id IN (${placeholders(ids.length)})` : '0', ...ids);
  }

  if (f.connected_to) {
    const ids = connectedWithin(f.connected_to, Number(f.connection_depth) || 2)
      .filter(r => r.depth > 0).map(r => r.person_id);
    push(ids.length ? `p.id IN (${placeholders(ids.length)})` : '0', ...ids);
  }

  return { sql: where.length ? 'WHERE ' + where.join('\n  AND ') : '', params };
}

// --- public API -------------------------------------------------------------

export function screen(filters = {}) {
  const { sql: whereSql, params } = buildWhere(filters);
  const order = SORTS[filters.sort] || SORTS.seniority;
  const limit = Math.min(Number(filters.limit) || 50, 500);
  const offset = Number(filters.offset) || 0;

  const total = one(`SELECT COUNT(*) AS n FROM v_person p ${whereSql}`, params).n;

  const rows = all(
    `SELECT p.* FROM v_person p ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset]);

  for (const row of rows) decorate(row);

  return { total, limit, offset, count: rows.length, rows };
}

/** Attach the short lists a result card needs, in one query per dimension. */
function decorate(row) {
  row.practice_areas = all(
    `SELECT pa.slug, pa.name, ppa.emphasis
     FROM person_practice_area ppa JOIN practice_area pa ON pa.id = ppa.practice_area_id
     WHERE ppa.person_id = ?
     ORDER BY CASE ppa.emphasis WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, pa.sort_order`,
    [row.id]);
  row.courts = all(
    `SELECT c.slug, COALESCE(c.short_name, c.name) AS name, pc.frequency
     FROM person_court pc JOIN court c ON c.id = pc.court_id
     WHERE pc.person_id = ?
     ORDER BY CASE pc.frequency WHEN 'primary' THEN 0 WHEN 'regular' THEN 1 ELSE 2 END, c.sort_order`,
    [row.id]);
  row.languages = all(
    `SELECT l.code, l.name FROM person_language pl JOIN language l ON l.code = pl.language_code
     WHERE pl.person_id = ? ORDER BY l.name`, [row.id]);
  return row;
}

/**
 * Counts for the facet sidebar, computed over the current result set so the
 * user can see where the remaining candidates are.
 */
export function facets(filters = {}) {
  const { sql: whereSql, params } = buildWhere(filters);
  const base = `SELECT p.id FROM v_person p ${whereSql}`;

  return {
    // Counted at the top level: someone tagged only with "Writ Petitions"
    // still counts towards "Constitutional & Public Law".
    practice_areas: all(
      `WITH RECURSIVE root_of(id, root_id) AS (
         SELECT id, id FROM practice_area WHERE parent_id IS NULL
         UNION ALL
         SELECT pa.id, r.root_id FROM practice_area pa JOIN root_of r ON pa.parent_id = r.id
       )
       SELECT top.slug, top.name, COUNT(DISTINCT ppa.person_id) AS n
       FROM person_practice_area ppa
       JOIN root_of ro ON ro.id = ppa.practice_area_id
       JOIN practice_area top ON top.id = ro.root_id
       WHERE ppa.person_id IN (${base})
       GROUP BY top.id ORDER BY n DESC, top.sort_order`, params),
    courts: all(
      `SELECT c.slug, COALESCE(c.short_name, c.name) AS name, COUNT(DISTINCT pc.person_id) AS n
       FROM person_court pc JOIN court c ON c.id = pc.court_id
       WHERE pc.person_id IN (${base})
       GROUP BY c.id ORDER BY n DESC, c.sort_order LIMIT 20`, params),
    cities: all(
      `SELECT p2.base_city AS slug, p2.base_city AS name, COUNT(*) AS n
       FROM person p2 WHERE p2.id IN (${base}) AND p2.base_city IS NOT NULL
       GROUP BY p2.base_city ORDER BY n DESC, p2.base_city`, params),
    designations: all(
      `SELECT p2.designation AS slug, p2.designation AS name, COUNT(*) AS n
       FROM person p2 WHERE p2.id IN (${base}) GROUP BY p2.designation ORDER BY n DESC`, params),
    languages: all(
      `SELECT l.code AS slug, l.name, COUNT(DISTINCT pl.person_id) AS n
       FROM person_language pl JOIN language l ON l.code = pl.language_code
       WHERE pl.person_id IN (${base}) GROUP BY l.code ORDER BY n DESC, l.name LIMIT 15`, params),
    institutions: all(
      `SELECT i.slug, COALESCE(i.short_name, i.name) AS name, COUNT(DISTINCT pe.person_id) AS n
       FROM person_education pe JOIN institution i ON i.id = pe.institution_id
       WHERE pe.person_id IN (${base}) GROUP BY i.id ORDER BY n DESC, i.name LIMIT 15`, params),
    batches: all(
      `SELECT CAST(p2.batch_year AS TEXT) AS slug, CAST(p2.batch_year AS TEXT) AS name, COUNT(*) AS n
       FROM v_person p2 WHERE p2.id IN (${base}) AND p2.batch_year IS NOT NULL
       GROUP BY p2.batch_year ORDER BY p2.batch_year DESC`, params),
    states: all(
      `SELECT p2.base_state AS slug, p2.base_state AS name, COUNT(*) AS n
       FROM person p2 WHERE p2.id IN (${base}) AND p2.base_state IS NOT NULL
       GROUP BY p2.base_state ORDER BY n DESC, p2.base_state`, params),
    organisations: all(
      `SELECT o.slug, o.name, COUNT(DISTINCT pa.person_id) AS n
       FROM person_affiliation pa JOIN organisation o ON o.id = pa.organisation_id
       WHERE pa.person_id IN (${base}) GROUP BY o.id ORDER BY n DESC, o.name LIMIT 20`, params),
    relationship_categories: all(
      `SELECT rt.category AS slug, rt.category AS name, COUNT(DISTINCT x.person_id) AS n
       FROM (SELECT from_person_id AS person_id, type FROM relationship
             UNION ALL SELECT to_person_id, type FROM relationship) x
       JOIN relationship_type rt ON rt.code = x.type
       WHERE x.person_id IN (${base}) GROUP BY rt.category ORDER BY n DESC`, params),
  };
}

// ---------------------------------------------------------------------------
// Browse dimensions — "show me everything, grouped by X".
//
// Each dimension answers: what values exist, how many people in each, and what
// filter opens that slice of the directory. This is the entry point the
// screener is not: no filter form, just a list you can read down.
// ---------------------------------------------------------------------------

export const DIMENSIONS = {
  'practice-area': {
    label: 'Practice area', filter: 'practice_areas', blurb: 'What they do.',
    query: `WITH RECURSIVE root_of(id, root_id) AS (
              SELECT id, id FROM practice_area WHERE parent_id IS NULL
              UNION ALL
              SELECT pa.id, r.root_id FROM practice_area pa JOIN root_of r ON pa.parent_id = r.id)
            SELECT top.slug, top.name, top.description AS detail, COUNT(DISTINCT ppa.person_id) AS n
            FROM practice_area top
            LEFT JOIN root_of ro ON ro.root_id = top.id
            LEFT JOIN person_practice_area ppa ON ppa.practice_area_id = ro.id
            LEFT JOIN person p ON p.id = ppa.person_id AND p.visibility = 'public'
            WHERE top.parent_id IS NULL
            GROUP BY top.id ORDER BY n DESC, top.sort_order`,
  },
  court: {
    label: 'Court or forum', filter: 'courts', blurb: 'Where they appear.',
    groupBy: 'court_type',
    query: `SELECT c.slug, COALESCE(c.short_name, c.name) AS name, c.name AS detail,
                   c.court_type AS grp, COUNT(DISTINCT pc.person_id) AS n
            FROM court c
            LEFT JOIN person_court pc ON pc.court_id = c.id
            LEFT JOIN person p ON p.id = pc.person_id AND p.visibility = 'public'
            GROUP BY c.id HAVING n > 0 ORDER BY n DESC, c.sort_order`,
  },
  city: {
    label: 'City', filter: 'city', blurb: 'Where they are based.',
    query: `SELECT p.base_city AS slug, p.base_city AS name, p.base_state AS detail, COUNT(*) AS n
            FROM person p WHERE p.visibility = 'public' AND p.base_city IS NOT NULL
            GROUP BY p.base_city ORDER BY n DESC, p.base_city`,
  },
  'law-school': {
    label: 'Law school', filter: 'institutions', blurb: 'Where they studied.',
    query: `SELECT i.slug, COALESCE(i.short_name, i.name) AS name, i.name AS detail,
                   COUNT(DISTINCT pe.person_id) AS n
            FROM institution i
            JOIN person_education pe ON pe.institution_id = i.id
            JOIN person p ON p.id = pe.person_id AND p.visibility = 'public'
            GROUP BY i.id ORDER BY n DESC, i.name`,
  },
  batch: {
    label: 'Batch', filter: 'batch_year', blurb: 'Year they graduated.',
    query: `SELECT CAST(p.batch_year AS TEXT) AS slug, 'Class of ' || p.batch_year AS name,
                   NULL AS detail, COUNT(*) AS n
            FROM v_person p WHERE p.visibility = 'public' AND p.batch_year IS NOT NULL
            GROUP BY p.batch_year ORDER BY p.batch_year DESC`,
  },
  chamber: {
    label: 'Chamber or firm', filter: 'organisations', blurb: 'Who they work with.',
    groupBy: 'type',
    query: `SELECT o.slug, o.name, o.city AS detail, o.type AS grp,
                   COUNT(DISTINCT pa.person_id) AS n
            FROM organisation o
            LEFT JOIN person_affiliation pa ON pa.organisation_id = o.id
            LEFT JOIN person p ON p.id = pa.person_id AND p.visibility = 'public'
            GROUP BY o.id ORDER BY n DESC, o.name`,
  },
  standing: {
    label: 'Standing', filter: 'designation', blurb: 'Rank at the Bar.',
    query: `SELECT p.designation AS slug, p.designation AS name, NULL AS detail, COUNT(*) AS n
            FROM person p WHERE p.visibility = 'public'
            GROUP BY p.designation ORDER BY n DESC`,
  },
  language: {
    label: 'Language', filter: 'languages', blurb: 'What they can appear in.',
    query: `SELECT l.code AS slug, l.name, NULL AS detail, COUNT(DISTINCT pl.person_id) AS n
            FROM language l
            JOIN person_language pl ON pl.language_code = l.code
            JOIN person p ON p.id = pl.person_id AND p.visibility = 'public'
            GROUP BY l.code ORDER BY n DESC, l.name`,
  },
  'bar-council': {
    label: 'Bar Council', filter: 'bar_councils', blurb: 'Where they are enrolled.',
    query: `SELECT bc.slug, bc.name, bc.state AS detail, COUNT(*) AS n
            FROM bar_council bc JOIN person p ON p.bar_council_id = bc.id
            WHERE p.visibility = 'public'
            GROUP BY bc.id ORDER BY n DESC, bc.name`,
  },
  relationship: {
    label: 'Relationship', filter: 'relationship_types', blurb: 'How they are connected.',
    groupBy: 'category',
    query: `SELECT rt.code AS slug, rt.label AS name, rt.description AS detail,
                   rt.category AS grp, COUNT(DISTINCT x.person_id) AS n
            FROM relationship_type rt
            LEFT JOIN (SELECT from_person_id AS person_id, type FROM relationship
                       UNION ALL SELECT to_person_id, type FROM relationship) x ON x.type = rt.code
            LEFT JOIN person p ON p.id = x.person_id AND p.visibility = 'public'
            GROUP BY rt.code HAVING n > 0 ORDER BY rt.category, n DESC`,
  },
};

export function browse(dimension) {
  const dim = DIMENSIONS[dimension];
  if (!dim) return null;
  const rows = all(dim.query).filter(r => r.n > 0);
  if (!dim.groupBy) return { ...dim, key: dimension, rows, groups: null };
  const groups = {};
  for (const r of rows) (groups[r.grp || 'other'] ||= []).push(r);
  return { ...dim, key: dimension, rows, groups };
}

/** Headline counts for the browse hub. */
export function overview() {
  return one(`SELECT
    (SELECT COUNT(*) FROM person WHERE visibility = 'public') AS people,
    (SELECT COUNT(*) FROM organisation) AS organisations,
    (SELECT COUNT(*) FROM relationship) AS relationships,
    (SELECT COUNT(*) FROM person_note) AS notes,
    (SELECT COUNT(DISTINCT base_city) FROM person WHERE base_city IS NOT NULL) AS cities,
    (SELECT COUNT(*) FROM v_person WHERE visibility = 'public' AND note_count = 0) AS unnoted,
    (SELECT COUNT(*) FROM v_person WHERE visibility = 'public' AND batch_year IS NOT NULL) AS with_batch`);
}
