// Zero-dependency HTTP server.
//
// Binds to 127.0.0.1 only. This is a personal working copy holding private
// notes; it must not be reachable from the network. Change HOST deliberately.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, all, one, run } from './db.js';
import { screen, facets, browse, DIMENSIONS, overview } from './screen.js';
import { getProfile, networkGraph } from './profile.js';
import {
  browseHubPage, browseDimensionPage, directoryPage, profilePage, notesPage,
  chambersPage, chamberPage, networkPage, networkIndexPage, aboutPage,
} from './views/pages.js';
import { layout, esc } from './views/layout.js';

const PORT = Number(process.env.PORT) || 4700;
const HOST = process.env.HOST || '127.0.0.1';

const MULTI = new Set(['practice_areas', 'courts', 'languages', 'institutions',
  'organisations', 'designation', 'status', 'fee_band', 'verification_status',
  'bar_councils', 'emphasis', 'court_frequency', 'batch_year', 'missing',
  'relationship_types', 'relationship_categories']);

function parseParams(url) {
  const params = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key).filter(v => v !== '');
    if (!values.length) continue;
    params[key] = values.length > 1 || MULTI.has(key) ? values : values[0];
  }
  return params;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1e6) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}

const send = (res, status, type, body) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(body);
};
const html = (res, body, status = 200) => send(res, status, 'text/html; charset=utf-8', body);
const json = (res, data, status = 200) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
const redirect = (res, to) => { res.writeHead(303, { location: to }); res.end(); };

const STATIC = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const params = parseParams(url);
  const wantsJson = params.format === 'json' || url.pathname.startsWith('/api/');
  const seg = url.pathname.split('/').filter(Boolean);

  try {
    // --- writes -------------------------------------------------------------
    if (req.method === 'POST') return await handlePost(req, res, seg);

    // --- static -------------------------------------------------------------
    const ext = path.extname(url.pathname);
    if (STATIC[ext]) {
      const file = path.join(ROOT, 'public', path.basename(url.pathname));
      if (fs.existsSync(file)) return send(res, 200, STATIC[ext], fs.readFileSync(file));
      return html(res, notFound('Asset not found'), 404);
    }

    // --- browse hub ---------------------------------------------------------
    if (url.pathname === '/') {
      const counts = overview();
      counts.savedScreens = all(`SELECT slug, name, audience FROM saved_screen ORDER BY audience, name`);
      const dimensions = Object.keys(DIMENSIONS).map(key => {
        const d = browse(key);
        return { key, label: d.label, blurb: d.blurb, count: d.rows.length };
      });
      if (wantsJson) return json(res, { counts, dimensions });
      const recentNotes = all(
        `SELECT n.id, n.kind, n.body, n.created_at, n.occurred_on, p.slug, p.full_name
         FROM person_note n JOIN person p ON p.id = n.person_id
         ORDER BY n.pinned DESC, n.created_at DESC LIMIT 6`);
      const THIN = [
        ['practice_areas', 'No practice area'], ['courts', 'No court'],
        ['class_of', 'No batch year'], ['city', 'No city'],
        ['relationships', 'No relationships'], ['notes', 'No notes from me'],
      ];
      const thin = THIN.map(([key, label]) => ({ key, label, n: screen({ missing: [key], limit: 1 }).total }))
        .filter(t => t.n > 0);
      return html(res, browseHubPage({ counts, dimensions, recentNotes, thin }));
    }

    // --- browse a dimension -------------------------------------------------
    if (seg[0] === 'browse' || (seg[0] === 'api' && seg[1] === 'browse')) {
      const key = seg[0] === 'browse' ? seg[1] : seg[2];
      const dim = browse(key);
      if (!dim) return wantsJson ? json(res, { error: 'unknown dimension', available: Object.keys(DIMENSIONS) }, 404)
                                 : html(res, notFound('No such browse dimension'), 404);
      if (wantsJson) return json(res, dim);
      const allDims = Object.entries(DIMENSIONS).map(([k, d]) => ({ key: k, label: d.label }));
      return html(res, browseDimensionPage(dim, allDims));
    }

    // --- directory / screener ----------------------------------------------
    if (url.pathname === '/directory' || url.pathname === '/screener' || url.pathname === '/api/screen') {
      const result = screen(params);
      if (wantsJson) return json(res, { filters: params, ...result });
      const savedScreens = all(`SELECT slug, name, audience FROM saved_screen ORDER BY audience, name`);
      return html(res, directoryPage({
        result, facetData: facets(params), params,
        mode: url.pathname === '/screener' ? 'screener' : 'directory', savedScreens,
      }));
    }

    // --- saved screen -------------------------------------------------------
    if (seg[0] === 'screen' && seg[1]) {
      const saved = one(`SELECT * FROM saved_screen WHERE slug = ?`, [seg[1]]);
      if (!saved) return html(res, notFound('No such saved screen'), 404);
      const filters = { ...JSON.parse(saved.filters), ...params };
      const result = screen(filters);
      if (wantsJson) return json(res, { saved, filters, ...result });
      const savedScreens = all(`SELECT slug, name, audience FROM saved_screen ORDER BY audience, name`);
      return html(res, directoryPage({
        result, facetData: facets(filters), params: filters, mode: 'screener', savedScreens,
      }));
    }

    // --- profile ------------------------------------------------------------
    if (seg[0] === 'lawyer' || (seg[0] === 'api' && seg[1] === 'lawyer')) {
      const slug = seg[0] === 'lawyer' ? seg[1] : seg[2];
      const p = getProfile(slug, { includeNotes: !wantsJson });
      if (!p) return wantsJson ? json(res, { error: 'not found' }, 404) : html(res, notFound('No such person'), 404);
      return wantsJson ? json(res, p) : html(res, profilePage(p));
    }

    // --- notes index --------------------------------------------------------
    if (url.pathname === '/notes') {
      const q = params.q;
      const notes = q
        ? all(`SELECT n.*, p.slug, p.full_name, p.honorific
               FROM person_note n JOIN person p ON p.id = n.person_id
               WHERE n.id IN (SELECT rowid FROM person_note_fts WHERE person_note_fts MATCH ?)
               ORDER BY n.pinned DESC, n.created_at DESC`,
              [q.trim().split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).map(t => `${t}*`).join(' ') || '""'])
        : all(`SELECT n.*, p.slug, p.full_name, p.honorific
               FROM person_note n JOIN person p ON p.id = n.person_id
               ORDER BY n.pinned DESC, n.created_at DESC LIMIT 200`);
      return html(res, notesPage(notes, q));
    }

    // --- chambers -----------------------------------------------------------
    if (url.pathname === '/chambers') {
      const orgs = all(
        `SELECT o.*, h.full_name AS head_name, h.slug AS head_slug,
                (SELECT COUNT(DISTINCT person_id) FROM person_affiliation pa WHERE pa.organisation_id = o.id) AS member_count
         FROM organisation o LEFT JOIN person h ON h.id = o.head_person_id
         ORDER BY o.type, o.name`);
      return wantsJson ? json(res, orgs) : html(res, chambersPage(orgs));
    }

    if (seg[0] === 'chamber' && seg[1]) {
      const org = one(`SELECT o.*, h.full_name AS head_name, h.slug AS head_slug
                       FROM organisation o LEFT JOIN person h ON h.id = o.head_person_id
                       WHERE o.slug = ?`, [seg[1]]);
      if (!org) return html(res, notFound('No such chamber or firm'), 404);
      const members = all(
        `SELECT p.slug, p.full_name, p.honorific, p.headline, pa.role, pa.start_year, pa.end_year, pa.is_current
         FROM person_affiliation pa JOIN person p ON p.id = pa.person_id
         WHERE pa.organisation_id = ? AND p.visibility = 'public'
         ORDER BY pa.is_current DESC, pa.start_year ASC NULLS LAST`, [org.id]);
      return wantsJson ? json(res, { ...org, members }) : html(res, chamberPage(org, members));
    }

    // --- network ------------------------------------------------------------
    if (seg[0] === 'network' || (seg[0] === 'api' && seg[1] === 'network')) {
      const slug = seg[0] === 'network' ? seg[1] : seg[2];
      const depth = Math.min(Math.max(Number(params.depth) || 2, 1), 3);
      if (!slug) {
        const people = all(
          `SELECT p.slug, p.full_name, p.honorific, p.headline,
                  (SELECT COUNT(*) FROM relationship r
                    WHERE r.from_person_id = p.id OR r.to_person_id = p.id) AS degree
           FROM person p WHERE p.visibility = 'public'
           ORDER BY degree DESC, p.full_name LIMIT 60`);
        return wantsJson ? json(res, people) : html(res, networkIndexPage(people));
      }
      const graph = networkGraph(slug, depth);
      if (!graph) return wantsJson ? json(res, { error: 'not found' }, 404) : html(res, notFound('No such person'), 404);
      if (wantsJson) return json(res, graph);
      const root = one(`SELECT slug, full_name, honorific FROM person WHERE slug = ?`, [slug]);
      return html(res, networkPage(graph, root, depth));
    }

    // --- taxonomy / about ---------------------------------------------------
    if (url.pathname === '/api/taxonomy') {
      return json(res, {
        practice_areas: all(`SELECT pa.slug, pa.name, parent.slug AS parent, pa.description
                             FROM practice_area pa LEFT JOIN practice_area parent ON parent.id = pa.parent_id
                             ORDER BY pa.sort_order`),
        courts: all(`SELECT slug, name, short_name, court_type, city, state, requires_aor FROM court ORDER BY sort_order, name`),
        institutions: all(`SELECT slug, name, short_name, city FROM institution ORDER BY name`),
        bar_councils: all(`SELECT slug, name, state, code FROM bar_council ORDER BY name`),
        languages: all(`SELECT code, name FROM language ORDER BY name`),
        relationship_types: all(`SELECT * FROM relationship_type ORDER BY category, code`),
        affiliation_roles: ['intern', 'law_clerk', 'chamber_junior', 'junior_counsel', 'associate',
          'senior_associate', 'principal_associate', 'counsel', 'of_counsel', 'partner',
          'equity_partner', 'founder', 'founding_partner', 'managing_partner', 'head_of_chambers',
          'standing_counsel', 'panel_counsel', 'in_house', 'other'],
        browse_dimensions: Object.keys(DIMENSIONS),
        saved_screens: all(`SELECT slug, name, audience, description, filters FROM saved_screen`),
      });
    }

    if (url.pathname === '/about') {
      const count = t => one(`SELECT COUNT(*) AS n FROM ${t}`).n;
      return html(res, aboutPage({
        counts: {
          person: count('person'), organisation: count('organisation'),
          relationship: count('relationship'), relationship_type: count('relationship_type'),
          practice_area: count('practice_area'), court: count('court'),
          person_note: count('person_note'),
        },
        relTypes: all(`SELECT * FROM relationship_type ORDER BY category, code`),
      }));
    }

    return wantsJson ? json(res, { error: 'not found' }, 404) : html(res, notFound(), 404);
  } catch (err) {
    console.error(err);
    return wantsJson
      ? json(res, { error: err.message }, 500)
      : html(res, layout({ title: 'Error', body: `<div class="prose"><h1>Something went wrong</h1><pre>${esc(err.message)}</pre></div>` }), 500);
  }
});

// --- note writes ------------------------------------------------------------

async function handlePost(req, res, seg) {
  // /lawyer/:slug/notes[/:id/(delete|pin)]
  if (seg[0] !== 'lawyer' || seg[2] !== 'notes') return html(res, notFound(), 404);
  const person = one(`SELECT id, slug FROM person WHERE slug = ?`, [seg[1]]);
  if (!person) return html(res, notFound('No such person'), 404);
  const back = `/lawyer/${person.slug}#notes`;

  const noteId = seg[3] ? Number(seg[3]) : null;
  const action = seg[4];

  if (noteId && action === 'delete') {
    run(`DELETE FROM person_note WHERE id = ? AND person_id = ?`, [noteId, person.id]);
    return redirect(res, back);
  }
  if (noteId && action === 'pin') {
    run(`UPDATE person_note SET pinned = 1 - pinned, updated_at = datetime('now')
         WHERE id = ? AND person_id = ?`, [noteId, person.id]);
    return redirect(res, back);
  }

  const body = await readBody(req);
  const text = (body.body || '').trim();
  if (text) {
    run(`INSERT INTO person_note (person_id, kind, body, occurred_on) VALUES (?,?,?,?)`,
        [person.id, body.kind || 'note', text, body.occurred_on || null]);
    run(`INSERT INTO change_log (entity_type, entity_id, field, new_value, actor, reason)
         VALUES ('person', ?, 'note', ?, 'owner', 'note added')`, [person.id, text.slice(0, 200)]);
  }
  return redirect(res, back);
}

function notFound(message = 'Page not found') {
  return layout({
    title: 'Not found',
    body: `<div class="prose"><h1>${esc(message)}</h1><p><a href="/">Back to browse</a></p></div>`,
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Advocates directory: http://${HOST}:${PORT}  (private, localhost only)`);
});
