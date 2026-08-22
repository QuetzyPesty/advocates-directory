import {
  esc, layout, personCard, signals, displayName, badges, years,
  TITLES, VERIFICATION, FEE_BANDS, NOTE_KINDS, COURT_TYPES, ORG_TYPES, REL_CATEGORIES,
} from './layout.js';
import { SORT_LABELS } from '../screen.js';

// --- helpers ----------------------------------------------------------------

/** Render a <dl>, or nothing at all when every row is empty. */
function definitionList(rows) {
  const filled = rows.filter(([, v]) => v != null && v !== false && v !== '');
  if (!filled.length) return '';
  return `<dl>${filled.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

const yearRange = (a, b) => a && b ? `${a}–${b}` : a ? `${a}–present` : b ? `until ${b}` : '';

function queryString(params, overrides = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) {
    if (v == null || v === '' || v === false) continue;
    (Array.isArray(v) ? v : [v]).forEach(x => q.append(k, x));
  }
  return q.toString();
}

// ============================================================================
// Browse hub — the landing page
// ============================================================================

const DIM_ICONS = {
  'practice-area': '§', court: '⚖', city: '◉', 'law-school': '✎', batch: '❯',
  chamber: '▣', standing: '★', language: '⌘', 'bar-council': '✦', relationship: '⁂',
};

export function browseHubPage({ counts, dimensions, recentNotes, thin }) {
  const body = `
  <div class="hub">
    <header class="hub-head">
      <h1>Browse</h1>
      <p class="lede">A personal record of the Bar. Pick a way in — or
        <a href="/screener">screen on several things at once</a>.</p>
      <ul class="stats">
        <li><strong>${counts.people}</strong> people</li>
        <li><strong>${counts.relationships}</strong> relationships</li>
        <li><strong>${counts.organisations}</strong> chambers &amp; firms</li>
        <li><strong>${counts.notes}</strong> notes</li>
        <li><strong>${counts.cities}</strong> cities</li>
      </ul>
    </header>

    <section class="dim-grid">
      ${dimensions.map(d => `<a class="dim" href="/browse/${esc(d.key)}">
        <span class="dim-icon" aria-hidden="true">${DIM_ICONS[d.key] || '•'}</span>
        <span class="dim-body">
          <strong>${esc(d.label)}</strong>
          <em>${esc(d.blurb)}</em>
          <span class="dim-count">${d.count} value${d.count === 1 ? '' : 's'}</span>
        </span>
      </a>`).join('')}
    </section>

    <div class="hub-cols">
      <section>
        <h2>Recently noted</h2>
        ${recentNotes.length ? `<ul class="note-feed">${recentNotes.map(n => `<li>
          <a href="/lawyer/${esc(n.slug)}">${esc(n.full_name)}</a>
          <span class="note-kind k-${esc(n.kind)}">${esc(NOTE_KINDS[n.kind] || n.kind)}</span>
          <p>${esc(n.body)}</p>
          <span class="meta">${esc((n.created_at || '').slice(0, 10))}</span>
        </li>`).join('')}</ul>
        <p><a href="/notes">All notes →</a></p>`
        : `<p class="empty">No notes yet. Open anyone's profile and start writing.</p>`}
      </section>

      <section>
        <h2>Needs filling in</h2>
        <ul class="thin-list">
          ${thin.map(t => `<li><a href="/directory?missing=${esc(t.key)}">
            <span>${esc(t.label)}</span><em>${t.n}</em></a></li>`).join('')}
        </ul>
        <h2>Saved screens</h2>
        <ul class="thin-list">
          ${(counts.savedScreens || []).map(s => `<li><a href="/screen/${esc(s.slug)}">
            <span>${esc(s.name)}</span><em class="aud">${esc(s.audience)}</em></a></li>`).join('')}
        </ul>
      </section>
    </div>
  </div>`;
  return layout({ title: 'Browse', body, active: '/' });
}

export function browseDimensionPage(dim, allDimensions) {
  const row = r => `<li>
    <a href="/directory?${esc(dim.filter)}=${encodeURIComponent(r.slug)}">
      <span class="bv-name">${esc(r.name)}</span>
      ${r.detail && r.detail !== r.name ? `<span class="bv-detail">${esc(r.detail)}</span>` : ''}
      <em>${r.n}</em>
    </a></li>`;

  const groupLabel = g =>
    COURT_TYPES[g] || ORG_TYPES[g] || REL_CATEGORIES[g] || g.replace(/_/g, ' ');

  const list = dim.groups
    ? Object.entries(dim.groups).map(([g, rows]) => `
        <section class="bv-group"><h2>${esc(groupLabel(g))}</h2>
        <ul class="browse-values">${rows.map(row).join('')}</ul></section>`).join('')
    : `<ul class="browse-values">${dim.rows.map(row).join('')}</ul>`;

  const body = `
  <nav class="dim-switch">
    ${allDimensions.map(d => `<a href="/browse/${esc(d.key)}"${d.key === dim.key ? ' class="on"' : ''}>${esc(d.label)}</a>`).join('')}
  </nav>
  <header class="browse-head">
    <h1>By ${esc(dim.label.toLowerCase())}</h1>
    <p class="meta">${esc(dim.blurb)} ${dim.rows.length} value${dim.rows.length === 1 ? '' : 's'} in use.</p>
  </header>
  ${list}`;
  return layout({ title: `By ${dim.label}`, body, active: '/' });
}

// ============================================================================
// Directory / screener
// ============================================================================

export function directoryPage({ result, facetData, params, mode = 'directory', savedScreens = [] }) {
  const base = mode === 'screener' ? '/screener' : '/directory';
  const activeChips = describeFilters(params);
  const advanced = mode === 'screener';

  // Facet groups. `open` decides which are expanded on first load — the point of
  // the change is that the sidebar no longer dumps everything at once.
  const groups = [
    { legend: 'Practice area', key: 'practice_areas', items: facetData.practice_areas, open: true },
    { legend: 'Court or forum', key: 'courts', items: facetData.courts, open: true },
    { legend: 'City', key: 'city', items: facetData.cities, single: true, open: true },
    { legend: 'Batch', key: 'batch_year', items: facetData.batches, open: advanced },
    { legend: 'Law school', key: 'institutions', items: facetData.institutions, open: advanced },
    { legend: 'Standing', key: 'designation', open: advanced,
      items: (facetData.designations || []).map(d => ({ ...d, name: TITLES[d.slug] || d.slug })) },
    { legend: 'Chamber or firm', key: 'organisations', items: facetData.organisations, open: false },
    { legend: 'Language', key: 'languages', items: facetData.languages, open: false },
    { legend: 'State', key: 'state', items: facetData.states, single: true, open: false },
    { legend: 'Relationships', key: 'relationship_categories', open: false,
      items: (facetData.relationship_categories || []).map(r => ({ ...r, name: REL_CATEGORIES[r.slug] || r.slug })) },
  ];

  const sidebar = `<aside class="facets">
    <form class="search" method="get" action="${base}">
      <input type="search" name="q" value="${esc(params.q || '')}" placeholder="Name or bio…">
      ${hiddenExcept(params, ['q', 'offset'])}
      <button type="submit">Search</button>
    </form>

    ${groups.map(g => facetGroup(base, g, params)).join('')}

    <details class="fgroup" ${params.accepts_interns || params.has_notes ? 'open' : ''}>
      <summary>Flags</summary>
      <ul>
        ${toggleLink(base, 'has_notes', 'I have notes on them', params)}
        ${toggleLink(base, 'accepts_interns', 'Takes interns', params)}
        ${toggleLink(base, 'accepts_direct_briefs', 'Accepts direct briefs', params)}
        ${toggleLink(base, 'takes_pro_bono', 'Takes pro bono', params)}
        ${toggleLink(base, 'legal_aid_panel', 'Legal aid panel', params)}
        ${toggleLink(base, 'available_for_mentoring', 'Available to mentor', params)}
        ${toggleLink(base, 'is_senior_advocate', 'Senior Advocate', params)}
        ${toggleLink(base, 'is_aor', 'Advocate-on-Record', params)}
      </ul>
    </details>

    <details class="fgroup" ${params.min_years || params.max_years || params.batch_from || params.note_q ? 'open' : ''}>
      <summary>Ranges &amp; note search</summary>
      <form class="range" method="get" action="${base}">
        <label>Years at the Bar</label>
        <div class="row">
          <input type="number" name="min_years" min="0" max="70" placeholder="from" value="${esc(params.min_years || '')}">
          <input type="number" name="max_years" min="0" max="70" placeholder="to" value="${esc(params.max_years || '')}">
        </div>
        <label>Batch</label>
        <div class="row">
          <input type="number" name="batch_from" min="1950" max="2100" placeholder="from" value="${esc(params.batch_from || '')}">
          <input type="number" name="batch_to" min="1950" max="2100" placeholder="to" value="${esc(params.batch_to || '')}">
        </div>
        <label>Search my notes</label>
        <input type="search" name="note_q" placeholder="e.g. arbitration, met at…" value="${esc(params.note_q || '')}">
        ${hiddenExcept(params, ['min_years', 'max_years', 'batch_from', 'batch_to', 'note_q', 'offset'])}
        <button type="submit">Apply</button>
      </form>
    </details>

    ${savedScreens.length ? `<details class="fgroup"><summary>Saved screens</summary><ul>
      ${savedScreens.map(s => `<li><a href="/screen/${esc(s.slug)}">
        <span>${esc(s.name)}</span><em class="aud">${esc(s.audience)}</em></a></li>`).join('')}
    </ul></details>` : ''}
  </aside>`;

  const results = `<section class="results">
    <div class="results-head">
      <h1>${advanced ? 'Screener' : 'Directory'}</h1>
      <p class="count"><strong>${result.total}</strong> ${result.total === 1 ? 'person' : 'people'}</p>
      <form class="sort" method="get" action="${base}">
        ${hiddenExcept(params, ['sort', 'offset'])}
        <label>Sort <select name="sort" onchange="this.form.submit()">
          ${Object.entries(SORT_LABELS).map(([v, l]) =>
            `<option value="${v}"${params.sort === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select></label>
      </form>
    </div>
    ${activeChips.length ? `<div class="chips">${activeChips.map(c =>
        `<a class="chip" href="${base}?${queryString(c.without)}">${esc(c.label)} <span>×</span></a>`).join('')}
      <a class="chip clear" href="${base}">Clear all</a></div>` : ''}
    ${result.rows.length
      ? `<div class="cards">${result.rows.map(personCard).join('')}</div>`
      : `<p class="empty">Nothing matches. Loosen a filter, or <a href="${base}">start over</a>.</p>`}
    ${pagination(base, params, result)}
  </section>`;

  return layout({
    title: advanced ? 'Screener' : 'Directory',
    body: `<div class="split">${sidebar}${results}</div>`,
    active: base,
  });
}

function facetGroup(base, { legend, key, items, single, open }, params) {
  if (!items?.length) return '';
  const anyActive = params[key] != null && params[key] !== '';
  return `<details class="fgroup"${open || anyActive ? ' open' : ''}>
    <summary>${esc(legend)}</summary>
    <ul>${items.map(i => single
      ? singleFacetLink(base, key, i.slug, i.name, i.n, params)
      : facetLink(base, key, i.slug, i.name, i.n, params)).join('')}</ul>
  </details>`;
}

function facetLink(base, key, value, label, count, params) {
  const current = params[key] ? (Array.isArray(params[key]) ? params[key] : [params[key]]) : [];
  const active = current.map(String).includes(String(value));
  const next = active ? current.filter(v => String(v) !== String(value)) : [...current, value];
  const qs = queryString({ ...params, [key]: next, offset: null });
  return `<li${active ? ' class="on"' : ''}><a href="${base}?${qs}">
    <span>${esc(label)}</span><em>${count}</em></a></li>`;
}

function singleFacetLink(base, key, value, label, count, params) {
  const active = params[key] === value;
  const qs = queryString({ ...params, [key]: active ? null : value, offset: null });
  return `<li${active ? ' class="on"' : ''}><a href="${base}?${qs}">
    <span>${esc(label)}</span><em>${count}</em></a></li>`;
}

function toggleLink(base, key, label, params) {
  const active = params[key] === 'true' || params[key] === true;
  const qs = queryString({ ...params, [key]: active ? null : 'true', offset: null });
  return `<li${active ? ' class="on"' : ''}><a href="${base}?${qs}">
    <span>${esc(label)}</span><em>${active ? '✓' : ''}</em></a></li>`;
}

function hiddenExcept(params, exclude) {
  const out = [];
  for (const [k, v] of Object.entries(params)) {
    if (exclude.includes(k) || v == null || v === '') continue;
    (Array.isArray(v) ? v : [v]).forEach(x =>
      out.push(`<input type="hidden" name="${esc(k)}" value="${esc(x)}">`));
  }
  return out.join('');
}

const CHIP_LABELS = {
  q: 'Search', practice_areas: 'Area', courts: 'Court', city: 'City', state: 'State',
  designation: 'Standing', languages: 'Language', institutions: 'School',
  organisations: 'Chamber', batch_year: 'Class of', batch_from: 'Batch from',
  batch_to: 'Batch to', min_years: 'Min years', max_years: 'Max years',
  chamber_lineage_of: 'Chamber lineage of', connected_to: 'Connected to',
  relationship_types: 'Relationship', relationship_categories: 'Relationship',
  missing: 'Missing', note_q: 'In my notes', has_notes: 'Has notes',
  accepts_interns: 'Takes interns', accepts_direct_briefs: 'Direct briefs',
  takes_pro_bono: 'Pro bono', legal_aid_panel: 'Legal aid',
  available_for_mentoring: 'Mentors', is_senior_advocate: 'Senior Advocate', is_aor: 'AoR',
};

function describeFilters(params) {
  const chips = [];
  for (const [k, v] of Object.entries(params)) {
    if (!(k in CHIP_LABELS) || v == null || v === '') continue;
    for (const one of Array.isArray(v) ? v : [v]) {
      const rest = Array.isArray(v) ? v.filter(x => x !== one) : null;
      chips.push({
        label: `${CHIP_LABELS[k]}: ${one === 'true' ? 'yes' : one}`,
        without: { ...params, [k]: rest && rest.length ? rest : null, offset: null },
      });
    }
  }
  return chips;
}

function pagination(base, params, result) {
  const { total, limit, offset } = result;
  if (total <= limit) return '';
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  const link = (o, label, disabled) => disabled
    ? `<span class="pg disabled">${label}</span>`
    : `<a class="pg" href="${base}?${queryString({ ...params, offset: o })}">${label}</a>`;
  return `<nav class="pagination">
    ${link(Math.max(0, offset - limit), '← Previous', offset === 0)}
    <span class="pg-info">Page ${page} of ${pages}</span>
    ${link(offset + limit, 'Next →', offset + limit >= total)}
  </nav>`;
}

// ============================================================================
// Profile
// ============================================================================

export function profilePage(p) {
  const v = VERIFICATION[p.verification_status] || VERIFICATION.unverified;
  const y = years(p);
  const rel = p.relationships.byCategory;

  const section = (title, inner, cls = '') =>
    inner ? `<section class="panel ${cls}"><h2>${esc(title)}</h2>${inner}</section>` : '';

  const areaList = emphasis => {
    const items = p.practice_areas.filter(a => a.emphasis === emphasis);
    if (!items.length) return '';
    return `<div class="area-group"><h4>${emphasis === 'primary' ? 'Principal'
      : emphasis === 'secondary' ? 'Also practises' : 'Occasional'}</h4>
      <div class="tags">${items.map(a =>
        `<a class="tag ${emphasis}" href="/directory?practice_areas=${esc(a.slug)}"${a.parent_name
          ? ` title="${esc(a.parent_name)}"` : ''}>${esc(a.name)}${a.years_active
          ? ` <em>${a.years_active}y</em>` : ''}</a>`).join('')}</div></div>`;
  };

  const relBlock = (cat, hint) => {
    const edges = rel[cat];
    if (!edges?.length) return '';
    return `<div class="rel-group"><h4>${esc(REL_CATEGORIES[cat] || cat)}${hint ? ` <small>${esc(hint)}</small>` : ''}</h4>
      <ul class="rel-list">${edges.map(e => `<li>
        <span class="rel-label">${esc(e.label)}</span>
        <a href="/lawyer/${esc(e.other_slug)}">${esc([e.other_honorific, e.other_name].filter(Boolean).join(' '))}</a>
        ${e.other_designation && e.other_designation !== 'advocate'
          ? `<span class="rel-desig">${esc(TITLES[e.other_designation] || e.other_designation)}</span>` : ''}
        ${e.organisation_name ? `<span class="rel-ctx">${esc(e.organisation_name)}</span>` : ''}
        ${e.institution_name ? `<span class="rel-ctx">${esc(e.institution_name)}</span>` : ''}
        ${e.court_short || e.court_name ? `<span class="rel-ctx">${esc(e.court_short || e.court_name)}</span>` : ''}
        ${yearRange(e.start_year, e.end_year) ? `<span class="rel-years">${yearRange(e.start_year, e.end_year)}</span>` : ''}
        ${e.verified ? '<span class="rel-verified" title="Verified">✓</span>' : ''}
        ${e.note ? `<p class="rel-note">${esc(e.note)}</p>` : ''}
      </li>`).join('')}</ul></div>`;
  };

  const engagement = p.accepts_direct_briefs === 0
    ? `<p class="engagement warn"><strong>Not engaged directly.</strong>
       ${p.is_senior_advocate
         ? 'A Senior Advocate is instructed by an Advocate-on-Record or an instructing advocate.'
         : 'Instructions come through an instructing advocate.'}</p>`
    : p.accepts_direct_briefs === 1
      ? `<p class="engagement ok"><strong>Takes instructions directly.</strong></p>` : '';

  // --- the diary layer ---
  const notesPanel = `<section class="panel notes" id="notes">
    <h2>My notes <span class="private-tag">private</span></h2>
    ${p.notes.length ? `<ul class="note-list">${p.notes.map(n => `<li class="${n.pinned ? 'pinned' : ''}">
      <div class="note-top">
        <span class="note-kind k-${esc(n.kind)}">${esc(NOTE_KINDS[n.kind] || n.kind)}</span>
        <span class="meta">${esc(n.occurred_on || (n.created_at || '').slice(0, 10))}</span>
        <form method="post" action="/lawyer/${esc(p.slug)}/notes/${n.id}/pin" class="inline">
          <button type="submit" class="linkish" title="Pin to the top">${n.pinned ? '★' : '☆'}</button>
        </form>
        <form method="post" action="/lawyer/${esc(p.slug)}/notes/${n.id}/delete" class="inline">
          <button type="submit" class="linkish danger" title="Delete">×</button>
        </form>
      </div>
      <p>${esc(n.body).replace(/\n/g, '<br>')}</p>
    </li>`).join('')}</ul>` : '<p class="empty">Nothing written down yet.</p>'}

    <form class="note-form" method="post" action="/lawyer/${esc(p.slug)}/notes">
      <textarea name="body" rows="3" placeholder="Impressions, who said what, things to follow up…" required></textarea>
      <div class="note-form-row">
        <select name="kind">
          ${Object.entries(NOTE_KINDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
        </select>
        <input type="date" name="occurred_on" aria-label="When">
        <button type="submit">Add note</button>
      </div>
    </form>
  </section>`;

  const body = `
  <div class="profile">
    <header class="profile-head">
      <div>
        <h1>${esc(displayName(p))}</h1>
        <p class="badges">${badges(p)}
          <span class="vtag ${v.cls}" title="${esc(v.hint)}">${v.label}</span></p>
        <p class="meta">${[
          TITLES[p.designation] || p.designation,
          y != null ? `${y} years at the Bar (since ${p.first_year_of_practice})` : null,
          p.batch_year ? `<a href="/directory?batch_year=${p.batch_year}">Class of ${p.batch_year}</a>` : null,
          p.base_city ? `<a href="/directory?city=${encodeURIComponent(p.base_city)}">${esc(p.base_city)}</a>` : null,
        ].filter(Boolean).join(' · ')}</p>
        ${p.headline ? `<p class="headline">${esc(p.headline)}</p>` : ''}
        ${signals(p)}
      </div>
      <div class="profile-actions">
        <a class="button" href="#notes">✎ Notes (${p.notes.length})</a>
        <a class="button ghost" href="/network/${esc(p.slug)}">Network</a>
        <a class="button ghost" href="/directory?chamber_lineage_of=${esc(p.slug)}">Lineage</a>
        <a class="button ghost" href="/lawyer/${esc(p.slug)}?format=json">JSON</a>
      </div>
    </header>

    ${engagement}

    <div class="profile-grid">
      <div class="profile-main">
        ${notesPanel}

        ${section('About', [p.short_bio, p.long_bio].filter(Boolean).map(t => `<p>${esc(t)}</p>`).join(''))}

        ${section('Practice areas', ['primary', 'secondary', 'occasional'].map(areaList).join(''))}

        ${section('Courts and forums', p.courts.length ? `<ul class="court-list">${p.courts.map(c => `
          <li class="freq-${esc(c.frequency)}">
            <a href="/directory?courts=${esc(c.slug)}">${esc(c.short_name || c.name)}</a>
            <span class="freq">${esc(c.frequency)}</span>
            ${c.since_year ? `<span class="since">since ${c.since_year}</span>` : ''}
            ${c.requires_aor ? '<span class="aor-note">AoR required to file</span>' : ''}
          </li>`).join('')}</ul>` : '')}

        ${section('Relationships', p.relationships.edges.length ? `
          ${relBlock('chamber', 'who trained whom')}
          ${relBlock('family')}
          ${relBlock('professional', 'briefing, leading, co-counsel')}
          ${relBlock('firm')}
          ${relBlock('education')}
          ${relBlock('court')}` : '', 'relationships')}

        ${section('Reported matters', p.matters.length ? `<ul class="matters">${p.matters.map(m => `
          <li><strong>${esc(m.title)}</strong>${m.citation ? ` <span class="cite">${esc(m.citation)}</span>` : ''}
            <p class="meta">${[m.court_short || m.court_name, m.year, m.role?.replace(/_/g, ' '), m.side, m.outcome]
              .filter(Boolean).map(esc).join(' · ')}</p></li>`).join('')}</ul>` : '')}

        ${section('Publications', p.publications.length ? `<ul class="plain">${p.publications.map(x =>
          `<li>${x.url ? `<a href="${esc(x.url)}">${esc(x.title)}</a>` : esc(x.title)}
           <span class="meta">${[x.venue, x.year].filter(Boolean).map(esc).join(', ')}</span></li>`).join('')}</ul>` : '')}
      </div>

      <aside class="profile-side">
        ${section('At the Bar', definitionList([
          ['Bar Council', p.bar_council_name && esc(p.bar_council_name)],
          ['Enrolment', p.enrolment_number && esc(p.enrolment_number)],
          ['Enrolled', p.enrolment_year],
          ['Designated', p.senior_designated_year && `${p.senior_designated_year}${
            p.senior_designating_court ? ', ' + esc(p.senior_designating_court.short_name || p.senior_designating_court.name) : ''}`],
          ['AoR since', p.is_aor && p.aor_year],
          ['Principal court', p.primary_court_name &&
            `<a href="/directory?courts=${esc(p.primary_court_slug)}">${esc(p.primary_court_name)}</a>`],
          ['Fee band', p.fee_band && esc(FEE_BANDS[p.fee_band] || p.fee_band)],
        ]))}

        ${section('Chambers and firms', p.affiliations.length ? `<ul class="plain">${p.affiliations.map(a => `
          <li><a href="/chamber/${esc(a.organisation_slug)}">${esc(a.organisation_name)}</a>
            <span class="meta">${esc(a.role.replace(/_/g, ' '))}${
              yearRange(a.start_year, a.end_year) ? ' · ' + yearRange(a.start_year, a.end_year) : ''}</span></li>`).join('')}</ul>` : '')}

        ${section('Education', p.education.length ? `<ul class="plain">${p.education.map(e => `
          <li><a href="/directory?institutions=${esc(e.institution_slug)}">${esc(e.institution_short || e.institution_name)}</a>
            <span class="meta">${[e.degree, e.field, e.end_year].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ul>` : '')}

        ${section('Positions held', p.positions.length ? `<ul class="plain">${p.positions.map(x => `
          <li>${esc(x.title)}<span class="meta">${[x.body, yearRange(x.start_year, x.end_year)]
            .filter(Boolean).map(esc).join(' · ')}</span>${x.note ? `<p class="meta">${esc(x.note)}</p>` : ''}</li>`).join('')}</ul>` : '')}

        ${section('Clerkships', p.clerkships.length ? `<ul class="plain">${p.clerkships.map(c => `
          <li>${c.judge_slug ? `<a href="/lawyer/${esc(c.judge_slug)}">${esc([c.judge_honorific, c.judge_full_name].filter(Boolean).join(' '))}</a>`
            : esc(c.judge_name || 'Judge')}
            <span class="meta">${[c.court_name, yearRange(c.start_year, c.end_year)].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ul>` : '')}

        ${section('Languages', p.languages.length ? `<div class="tags">${p.languages.map(l =>
          `<a class="tag" href="/directory?languages=${esc(l.code)}">${esc(l.name)}${l.proficiency ? ` <em>${esc(l.proficiency)}</em>` : ''}</a>`).join('')}</div>` : '')}

        ${section('Credentials', p.credentials.length ? `<ul class="plain">${p.credentials.map(c =>
          `<li>${esc(c.name)}<span class="meta">${[c.issuer, c.year].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ul>` : '')}

        ${p.accepts_interns ? section('Internships',
          `<p>${esc(p.intern_intake_note || 'Takes interns; no further detail recorded.')}</p>`, 'interns') : ''}

        ${section('Contact', p.contacts.length ? `<ul class="plain">${p.contacts.map(c =>
          `<li><span class="ckind">${esc(c.kind.replace(/_/g, ' '))}</span> ${esc(c.value)}</li>`).join('')}</ul>`
          : '<p class="meta">Nothing recorded.</p>')}

        ${section('Where this came from', p.sources.length ? `<ul class="plain sources">${p.sources.map(s =>
          `<li>${s.url ? `<a href="${esc(s.url)}">${esc(s.title || s.url)}</a>` : esc(s.title || s.kind)}
           <span class="meta">${esc(s.kind.replace(/_/g, ' '))}${s.retrieved_at ? ' · ' + esc(s.retrieved_at) : ''}</span>
           ${s.note ? `<span class="meta">${esc(s.note)}</span>` : ''}</li>`).join('')}</ul>`
          : '<p class="meta">No source recorded.</p>')}
      </aside>
    </div>
  </div>`;

  return layout({ title: displayName(p), body });
}

// ============================================================================
// Notes index
// ============================================================================

export function notesPage(notes, q) {
  const body = `
  <header class="browse-head">
    <h1>My notes <span class="private-tag">private</span></h1>
    <p class="meta">${notes.length} note${notes.length === 1 ? '' : 's'}. Never exported, never shown to anyone else.</p>
    <form method="get" class="search inline-search">
      <input type="search" name="q" value="${esc(q || '')}" placeholder="Search notes…">
      <button type="submit">Search</button>
    </form>
  </header>
  ${notes.length ? `<ul class="note-feed wide">${notes.map(n => `<li>
    <a href="/lawyer/${esc(n.slug)}#notes">${esc([n.honorific, n.full_name].filter(Boolean).join(' '))}</a>
    <span class="note-kind k-${esc(n.kind)}">${esc(NOTE_KINDS[n.kind] || n.kind)}</span>
    <span class="meta">${esc(n.occurred_on || (n.created_at || '').slice(0, 10))}</span>
    <p>${esc(n.body).replace(/\n/g, '<br>')}</p>
  </li>`).join('')}</ul>` : '<p class="empty">No notes yet.</p>'}`;
  return layout({ title: 'My notes', body, active: '/notes' });
}

// ============================================================================
// Chambers
// ============================================================================

export function chambersPage(orgs) {
  const groups = {};
  for (const o of orgs) (groups[o.type] ||= []).push(o);
  const body = `<h1>Chambers &amp; firms</h1>
  ${Object.entries(groups).map(([type, list]) => `
    <h2>${esc(ORG_TYPES[type] || type)}</h2>
    <div class="cards">${list.map(o => `<article class="card org">
      <h3><a href="/chamber/${esc(o.slug)}">${esc(o.name)}</a></h3>
      <p class="meta">${[o.city, o.size_band && o.size_band + ' people',
        o.founded_year && 'est. ' + o.founded_year].filter(Boolean).map(esc).join(' · ')}</p>
      ${o.head_name ? `<p class="meta">Head: <a href="/lawyer/${esc(o.head_slug)}">${esc(o.head_name)}</a></p>` : ''}
      ${o.description ? `<p>${esc(o.description)}</p>` : ''}
      <p class="meta"><strong>${o.member_count}</strong> recorded member${o.member_count === 1 ? '' : 's'}</p>
    </article>`).join('')}</div>`).join('')}`;
  return layout({ title: 'Chambers & firms', body, active: '/chambers' });
}

export function chamberPage(org, members) {
  const current = members.filter(m => m.is_current);
  const past = members.filter(m => !m.is_current);
  const list = rows => `<ul class="plain member-list">${rows.map(m => `<li>
    <a href="/lawyer/${esc(m.slug)}">${esc([m.honorific, m.full_name].filter(Boolean).join(' '))}</a>
    <span class="meta">${esc(m.role.replace(/_/g, ' '))}${
      yearRange(m.start_year, m.end_year) ? ' · ' + yearRange(m.start_year, m.end_year) : ''}</span>
    ${m.headline ? `<p class="meta">${esc(m.headline)}</p>` : ''}
  </li>`).join('')}</ul>`;

  const body = `<div class="profile">
    <header class="profile-head"><div>
      <h1>${esc(org.name)}</h1>
      <p class="meta">${[ORG_TYPES[org.type] || org.type, org.city, org.size_band,
        org.founded_year && 'established ' + org.founded_year].filter(Boolean).map(esc).join(' · ')}</p>
      ${org.description ? `<p class="headline">${esc(org.description)}</p>` : ''}
    </div>
    <div class="profile-actions">
      ${org.head_slug ? `<a class="button" href="/directory?chamber_lineage_of=${esc(org.head_slug)}">Chamber lineage</a>` : ''}
      <a class="button ghost" href="/directory?organisations=${esc(org.slug)}">Screen members</a>
    </div></header>
    <div class="profile-grid"><div class="profile-main">
      ${current.length ? `<section class="panel"><h2>Currently here</h2>${list(current)}</section>` : ''}
      ${past.length ? `<section class="panel"><h2>Previously here</h2>${list(past)}</section>` : ''}
    </div></div>
  </div>`;
  return layout({ title: org.name, body, active: '/chambers' });
}

// ============================================================================
// Network
// ============================================================================

export function networkPage(graph, rootPerson, depth) {
  const body = `<div class="network-page">
    <header class="network-head">
      <h1>${rootPerson ? esc(displayName(rootPerson)) + ' — network' : 'Relationship network'}</h1>
      <p class="meta">${graph.nodes.length} people, ${graph.edges.length} relationships,
        ${depth} degree${depth === 1 ? '' : 's'} out.
        ${rootPerson ? `<a href="/lawyer/${esc(rootPerson.slug)}">Back to profile</a>` : ''}</p>
      <form method="get" class="depth-form">
        <label>Depth <select name="depth" onchange="this.form.submit()">
          ${[1, 2, 3].map(d => `<option value="${d}"${d === depth ? ' selected' : ''}>${d}</option>`).join('')}
        </select></label>
      </form>
      <ul class="legend">
        ${Object.entries(REL_CATEGORIES).map(([k, l]) =>
          `<li><i class="k-${k}"></i>${esc(l)}</li>`).join('')}
      </ul>
    </header>
    <div id="graph" data-graph="${esc(JSON.stringify(graph))}"></div>
    <p class="meta hint">Drag to reposition · click a node to open the profile · scroll to zoom</p>
  </div>`;
  return layout({ title: 'Network', body, active: '/network', script: '<script src="/network.js"></script>' });
}

export function networkIndexPage(people) {
  const body = `<h1>Relationship network</h1>
  <p class="lede">Pick a starting point to explore chamber lineage, briefing relationships,
     family ties and education links.</p>
  <div class="cards">${people.map(p => `<article class="card">
    <h3><a href="/network/${esc(p.slug)}">${esc([p.honorific, p.full_name].filter(Boolean).join(' '))}</a></h3>
    <p class="meta">${esc(p.headline || '')}</p>
    <p class="meta"><strong>${p.degree}</strong> relationship${p.degree === 1 ? '' : 's'}</p>
  </article>`).join('')}</div>`;
  return layout({ title: 'Network', body, active: '/network' });
}

// ============================================================================
// About
// ============================================================================

export function aboutPage({ counts, relTypes }) {
  const byCat = {};
  for (const t of relTypes) (byCat[t.category] ||= []).push(t);

  const body = `<div class="prose">
  <h1>About</h1>
  <p class="lede">A personal, structured record of the Bar — who practises what, where they
     appear, how they are connected, and what I know about them.</p>

  <h2>What is in it</h2>
  <ul>
    <li><strong>${counts.person}</strong> people across <strong>${counts.organisation}</strong> chambers and firms</li>
    <li><strong>${counts.relationship}</strong> relationships in <strong>${counts.relationship_type}</strong> typed categories</li>
    <li><strong>${counts.practice_area}</strong> practice areas, <strong>${counts.court}</strong> courts and forums</li>
    <li><strong>${counts.person_note}</strong> private notes</li>
  </ul>

  <h2>Ways in</h2>
  <p>The <a href="/">browse hub</a> is the front door — pick a dimension and read down the list.
     The <a href="/directory">directory</a> is a filtered list with facets.
     The <a href="/screener">screener</a> is the same engine with everything turned on:
     ranges, any/all matching, chamber lineage, degrees of separation, note search.</p>

  <h2>Notes are private</h2>
  <p>Notes live in their own table, default to private, and are excluded from every export and
     from the JSON API. That separation exists so this can stay a working diary now and still
     become something shareable later without anything leaking.</p>

  <h2>Relationship vocabulary</h2>
  ${Object.entries(byCat).map(([cat, types]) => `
    <h3>${esc(REL_CATEGORIES[cat] || cat)}</h3>
    <table class="rel-types"><tbody>${types.map(t => `<tr>
      <td><code>${esc(t.code)}</code></td>
      <td>${esc(t.label)}${t.symmetric ? ' <em>(symmetric)</em>'
        : t.inverse_code ? ` <em>↔ ${esc(t.inverse_code)}</em>` : ''}</td>
      <td>${esc(t.description || '')}</td></tr>`).join('')}</tbody></table>`).join('')}

  <h2>API</h2>
  <pre><code>GET /api/screen?practice_areas=arbitration&amp;batch_from=2000&amp;courts=bombay-hc
GET /api/browse/:dimension
GET /api/lawyer/:slug
GET /api/network/:slug?depth=2
GET /api/taxonomy</code></pre>
  <p class="meta">Notes are never included in API output.</p>
  </div>`;
  return layout({ title: 'About', body });
}
