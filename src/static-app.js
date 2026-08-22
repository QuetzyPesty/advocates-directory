// Client-side app for the static export. Reads the embedded dataset, renders
// everything from the hash route. No network access of any kind.
(function () {
  const DATA = JSON.parse(document.getElementById('dataset').textContent);
  const PEOPLE = DATA.people;
  const BY_SLUG = new Map(PEOPLE.map(p => [p.slug, p]));
  const app = document.getElementById('app');

  const esc = s => s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const TITLES = {
    advocate: 'Advocate', senior_advocate: 'Senior Advocate',
    advocate_on_record: 'Advocate-on-Record', senior_advocate_aor: 'Senior Advocate & AoR',
    solicitor: 'Solicitor', judge: 'Judge', retired_judge: 'Retired Judge',
    academic: 'Academic', in_house_counsel: 'In-house Counsel', other: 'Other',
  };
  const VERIF = {
    unverified: ['Unverified', 'v-none', 'From a personal list, not a checked source.'],
    source_backed: ['Source-backed', 'v-source', 'Entered from a cited public source.'],
    self_claimed: ['Self-claimed', 'v-claim', 'Confirmed by the advocate.'],
    bar_verified: ['Bar-verified', 'v-bar', 'Checked against Bar Council records.'],
  };
  const REL_CATS = { chamber: 'Chamber', family: 'Family', professional: 'Professional',
                     firm: 'Firm', education: 'Education', court: 'Court' };
  const FEE = { legal_aid: 'Legal aid', modest: 'Modest', mid: 'Mid', premium: 'Premium',
                senior_counsel: 'Senior counsel', unknown: 'Not stated' };

  // --- dimensions -----------------------------------------------------------
  // Each one: how to pull values off a person, and how to filter by one.
  const DIMS = {
    'practice-area': { label: 'Practice area', blurb: 'What they do', icon: '§',
      values: p => uniq(p.areas.map(a => [a.root_slug, a.root_name])),
      match: (p, v) => p.areas.some(a => a.root_slug === v || a.slug === v) },
    court: { label: 'Court or forum', blurb: 'Where they appear', icon: '⚖',
      values: p => p.courts.map(c => [c.slug, c.name]),
      match: (p, v) => p.courts.some(c => c.slug === v) },
    city: { label: 'City', blurb: 'Where they are based', icon: '◉',
      values: p => p.city ? [[p.city, p.city]] : [],
      match: (p, v) => p.city === v },
    'law-school': { label: 'Law school', blurb: 'Where they studied', icon: '✎',
      values: p => uniq(p.education.map(e => [e.slug, e.name])),
      match: (p, v) => p.education.some(e => e.slug === v) },
    batch: { label: 'Batch', blurb: 'Year they graduated', icon: '❯',
      values: p => p.batch ? [[String(p.batch), 'Class of ' + p.batch]] : [],
      match: (p, v) => String(p.batch) === v, sort: (a, b) => b.slug - a.slug },
    chamber: { label: 'Chamber or firm', blurb: 'Who they work with', icon: '▣',
      values: p => uniq(p.affiliations.map(a => [a.slug, a.name])),
      match: (p, v) => p.affiliations.some(a => a.slug === v) },
    standing: { label: 'Standing', blurb: 'Rank at the Bar', icon: '★',
      values: p => [[p.designation, TITLES[p.designation] || p.designation]],
      match: (p, v) => p.designation === v },
    language: { label: 'Language', blurb: 'What they can appear in', icon: '⌘',
      values: p => p.languages.map(l => [l.slug, l.name]),
      match: (p, v) => p.languages.some(l => l.slug === v) },
    relationship: { label: 'Relationship', blurb: 'How they are connected', icon: '⁂',
      values: p => uniq(edgesFor(p.slug).map(e => [e.type, e.label])),
      match: (p, v) => edgesFor(p.slug).some(e => e.type === v) },
  };

  function uniq(pairs) {
    const seen = new Set(); const out = [];
    for (const [k, v] of pairs) { if (k && !seen.has(k)) { seen.add(k); out.push([k, v]); } }
    return out;
  }

  function dimValues(key) {
    const counts = new Map();
    for (const p of PEOPLE) {
      for (const [slug, name] of DIMS[key].values(p)) {
        if (!counts.has(slug)) counts.set(slug, { slug, name, n: 0 });
        counts.get(slug).n++;
      }
    }
    const rows = [...counts.values()];
    return DIMS[key].sort ? rows.sort(DIMS[key].sort) : rows.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }

  // --- relationships --------------------------------------------------------
  const EDGES = new Map();
  for (const r of DATA.relationships) {
    push(EDGES, r.from, { ...r, other: r.to, type: r.type, label: r.label });
    push(EDGES, r.to, {
      ...r, other: r.from,
      type: r.symmetric ? r.type : (r.inverse || r.type),
      label: r.symmetric ? r.label : (DATA.inverseLabels[r.inverse] || r.label),
    });
  }
  function push(map, k, v) { if (!map.has(k)) map.set(k, []); map.get(k).push(v); }
  function edgesFor(slug) { return EDGES.get(slug) || []; }

  // --- filtering ------------------------------------------------------------
  function applyFilters(f) {
    let rows = PEOPLE.slice();
    if (f.q) {
      const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      rows = rows.filter(p => {
        const hay = [p.name, p.headline, p.short_bio, p.long_bio, p.city,
          p.areas.map(a => a.name).join(' '), p.affiliations.map(a => a.name).join(' '),
          p.education.map(e => e.name).join(' ')].join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    for (const [key, val] of Object.entries(f.dims || {})) {
      if (!val) continue;
      rows = rows.filter(p => DIMS[key].match(p, val));
    }
    const sorts = {
      seniority: (a, b) => (b.senior - a.senior) || (b.aor - a.aor) || ((a.since || 9999) - (b.since || 9999)),
      name_asc: (a, b) => a.name.localeCompare(b.name),
      experience_desc: (a, b) => (a.since || 9999) - (b.since || 9999),
      batch_desc: (a, b) => (b.batch || 0) - (a.batch || 0),
      batch_asc: (a, b) => (a.batch || 9999) - (b.batch || 9999),
    };
    return rows.sort(sorts[f.sort] || sorts.seniority);
  }

  // --- routing --------------------------------------------------------------
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const seg = pathPart.split('/').filter(Boolean);
    const q = new URLSearchParams(queryPart || '');
    const dims = {};
    for (const k of Object.keys(DIMS)) if (q.get(k)) dims[k] = q.get(k);
    return { seg, dims, q: q.get('q') || '', sort: q.get('sort') || 'seniority' };
  }

  function listHref(dims, extra) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(dims || {})) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(extra || {})) if (v) q.set(k, v);
    const s = q.toString();
    return '#/list' + (s ? '?' + s : '');
  }

  function render() {
    const r = parseHash();
    let body;
    if (r.seg[0] === 'browse' && DIMS[r.seg[1]]) body = viewBrowse(r.seg[1]);
    else if (r.seg[0] === 'person' && BY_SLUG.has(r.seg[1])) body = viewProfile(BY_SLUG.get(r.seg[1]));
    else if (r.seg[0] === 'net' && BY_SLUG.has(r.seg[1])) body = viewNetwork(BY_SLUG.get(r.seg[1]));
    else if (r.seg[0] === 'list') body = viewList(r);
    else body = viewHub();

    app.innerHTML = chrome(body, r);
    window.scrollTo(0, 0);
    if (r.seg[0] === 'net') mountGraph(r.seg[1]);
    wire();
  }

  function chrome(body, r) {
    const m = DATA.meta;
    return `<header class="site">
      <a class="brand" href="#/">⚖️ <span>${esc(m.title)}</span></a>
      <nav>
        <a href="#/"${!r.seg.length ? ' class="on"' : ''}>Browse</a>
        <a href="#/list"${r.seg[0] === 'list' ? ' class="on"' : ''}>Directory</a>
      </nav>
      <form class="topsearch" data-search><input type="search" name="q" value="${esc(r.q)}" placeholder="Search…"></form>
    </header>
    <div class="private-banner">
      Read-only snapshot of ${m.counts.people} records, generated ${esc(m.generated)}.
      ${m.includes_notes ? '<strong>Includes private notes.</strong>' : 'Private notes are not included.'}
      Records marked <em>unverified</em> come from a personal list, not a checked source.
    </div>
    <main>${body}</main>
    <footer><p>Static export — everything runs in your browser, nothing is sent anywhere.</p></footer>`;
  }

  // --- views ----------------------------------------------------------------

  function viewHub() {
    const m = DATA.meta;
    // Only offer dimensions that actually have values in this dataset.
    const dims = Object.entries(DIMS)
      .map(([k, d]) => [k, d, dimValues(k).length])
      .filter(([, , n]) => n > 0)
      .map(([k, d, n]) =>
      `<a class="dim" href="#/browse/${k}">
        <span class="dim-icon" aria-hidden="true">${d.icon}</span>
        <span class="dim-body"><strong>${esc(d.label)}</strong><em>${esc(d.blurb)}</em>
        <span class="dim-count">${n} value${n === 1 ? '' : 's'}</span></span></a>`).join('');

    const seniors = applyFilters({ dims: { standing: 'senior_advocate' } }).slice(0, 6);
    return `<div class="hub">
      <header class="hub-head">
        <h1>${esc(m.title)}</h1>
        <p class="lede">A structured record of the Bar — practice areas, courts, chambers,
          and how people are connected. Pick a way in.</p>
        <ul class="stats">
          <li><strong>${m.counts.people}</strong> people</li>
          <li><strong>${m.counts.relationships}</strong> relationships</li>
          <li><strong>${dimValues('chamber').length}</strong> chambers &amp; firms</li>
          <li><strong>${dimValues('city').length}</strong> cities</li>
        </ul>
      </header>
      <section class="dim-grid">${dims}</section>
      ${seniors.length ? `<div class="hub-cols"><section>
        <h2>Senior Advocates</h2>
        <div class="cards">${seniors.map(card).join('')}</div>
        <p><a href="${listHref({ standing: 'senior_advocate' })}">All Senior Advocates →</a></p>
      </section></div>` : ''}
    </div>`;
  }

  function viewBrowse(key) {
    const d = DIMS[key];
    const rows = dimValues(key);
    const nav = Object.entries(DIMS).filter(([k]) => dimValues(k).length)
      .map(([k, dd]) => `<a href="#/browse/${k}"${k === key ? ' class="on"' : ''}>${esc(dd.label)}</a>`).join('');
    return `<nav class="dim-switch">${nav}</nav>
      <header class="browse-head"><h1>By ${esc(d.label.toLowerCase())}</h1>
        <p class="meta">${esc(d.blurb)}. ${rows.length} values in use.</p></header>
      <ul class="browse-values">${rows.map(v => `<li>
        <a href="${listHref({ [key]: v.slug })}">
          <span class="bv-name">${esc(v.name)}</span><em>${v.n}</em></a></li>`).join('')}</ul>`;
  }

  function viewList(r) {
    const rows = applyFilters(r);
    const chips = Object.entries(r.dims).map(([k, v]) => {
      const rest = { ...r.dims }; delete rest[k];
      const name = (dimValues(k).find(x => x.slug === v) || {}).name || v;
      return `<a class="chip" href="${listHref(rest, { q: r.q, sort: r.sort })}">${esc(DIMS[k].label)}: ${esc(name)} <span>×</span></a>`;
    });
    if (r.q) chips.push(`<a class="chip" href="${listHref(r.dims, { sort: r.sort })}">Search: ${esc(r.q)} <span>×</span></a>`);

    const facets = Object.entries(DIMS).map(([k, d]) => {
      const sub = applyFilters({ ...r, dims: omit(r.dims, k) });
      const counts = new Map();
      for (const p of sub) for (const [slug, name] of d.values(p)) {
        if (!counts.has(slug)) counts.set(slug, { slug, name, n: 0 });
        counts.get(slug).n++;
      }
      const vals = [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 40);
      if (!vals.length) return '';
      const open = r.dims[k] || ['practice-area', 'court', 'city'].includes(k);
      return `<details class="fgroup"${open ? ' open' : ''}><summary>${esc(d.label)}</summary><ul>
        ${vals.map(v => {
          const active = r.dims[k] === v.slug;
          const next = active ? omit(r.dims, k) : { ...r.dims, [k]: v.slug };
          return `<li${active ? ' class="on"' : ''}><a href="${listHref(next, { q: r.q, sort: r.sort })}">
            <span>${esc(v.name)}</span><em>${v.n}</em></a></li>`;
        }).join('')}</ul></details>`;
    }).join('');

    const SORTS = { seniority: 'Seniority', experience_desc: 'Most experienced',
      name_asc: 'Name (A–Z)', batch_desc: 'Batch (newest)', batch_asc: 'Batch (oldest)' };

    return `<div class="split">
      <aside class="facets">
        <form class="search" data-search><input type="search" name="q" value="${esc(r.q)}" placeholder="Name or bio…"><button type="submit">Search</button></form>
        ${facets}
      </aside>
      <section class="results">
        <div class="results-head">
          <h1>Directory</h1>
          <p class="count"><strong>${rows.length}</strong> ${rows.length === 1 ? 'person' : 'people'}</p>
          <div class="sort"><label>Sort <select data-sort>
            ${Object.entries(SORTS).map(([v, l]) => `<option value="${v}"${r.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label></div>
        </div>
        ${chips.length ? `<div class="chips">${chips.join('')}<a class="chip clear" href="#/list">Clear all</a></div>` : ''}
        ${rows.length ? `<div class="cards">${rows.map(card).join('')}</div>`
                      : `<p class="empty">Nothing matches. <a href="#/list">Start over</a>.</p>`}
      </section></div>`;
  }

  function omit(obj, key) { const o = { ...obj }; delete o[key]; return o; }

  function card(p) {
    const [vl, vc, vh] = VERIF[p.verification] || VERIF.unverified;
    const facts = [TITLES[p.designation] || p.designation,
      p.years != null ? p.years + ' yrs' : null,
      p.batch ? 'Class of ' + p.batch : null, p.city].filter(Boolean);
    return `<article class="card">
      <div class="card-head"><h3><a href="#/person/${esc(p.slug)}">${esc(name(p))}</a></h3>
        ${p.senior ? `<span class="badge senior">Senior Advocate${p.senior_year ? ' ' + p.senior_year : ''}</span>` : ''}
        ${p.aor ? `<span class="badge aor">AoR${p.aor_year ? ' ' + p.aor_year : ''}</span>` : ''}
        ${p.status !== 'practising' ? `<span class="badge status">${esc(p.status.replace(/_/g, ' '))}</span>` : ''}
      </div>
      <p class="meta">${facts.map(esc).join(' · ')} <span class="vtag ${vc}" title="${esc(vh)}">${vl}</span></p>
      ${p.headline ? `<p class="headline">${esc(p.headline)}</p>` : ''}
      <div class="tags">
        ${p.areas.filter(a => a.emphasis === 'primary').slice(0, 4).map(a =>
          `<a class="tag primary" href="${listHref({ 'practice-area': a.root_slug })}">${esc(a.name)}</a>`).join('')}
        ${p.courts.slice(0, 3).map(c => `<a class="tag court" href="${listHref({ court: c.slug })}">${esc(c.name)}</a>`).join('')}
      </div>${signals(p)}</article>`;
  }

  function signals(p) {
    const out = [p.interns && '<span class="signal intern">Takes interns</span>',
      p.direct === 0 && '<span class="signal indirect">Brief via AoR</span>',
      p.legal_aid && '<span class="signal aid">Legal aid</span>',
      p.pro_bono && '<span class="signal probono">Pro bono</span>',
      p.mentors && '<span class="signal mentor">Mentors</span>'].filter(Boolean);
    return out.length ? `<p class="signals">${out.join('')}</p>` : '';
  }

  const name = p => [p.honorific, p.name].filter(Boolean).join(' ');
  const range = (a, b) => a && b ? a + '–' + b : a ? a + '–present' : b ? 'until ' + b : '';

  function viewProfile(p) {
    const [vl, vc, vh] = VERIF[p.verification] || VERIF.unverified;
    const sec = (t, inner, cls) => inner ? `<section class="panel ${cls || ''}"><h2>${esc(t)}</h2>${inner}</section>` : '';
    const dl = rows => {
      const f = rows.filter(([, v]) => v != null && v !== '' && v !== false);
      return f.length ? `<dl>${f.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
    };
    const plain = (items, fn) => items.length ? `<ul class="plain">${items.map(fn).join('')}</ul>` : '';

    const byCat = {};
    for (const e of edgesFor(p.slug)) (byCat[e.category] = byCat[e.category] || []).push(e);
    const relBlock = cat => !byCat[cat] ? '' : `<div class="rel-group"><h4>${esc(REL_CATS[cat] || cat)}</h4>
      <ul class="rel-list">${byCat[cat].map(e => {
        const o = BY_SLUG.get(e.other);
        return `<li><span class="rel-label">${esc(e.label)}</span>
          <a href="#/person/${esc(e.other)}">${esc(o ? name(o) : e.other)}</a>
          ${e.context.map(c => `<span class="rel-ctx">${esc(c)}</span>`).join('')}
          ${range(e.start_year, e.end_year) ? `<span class="rel-years">${range(e.start_year, e.end_year)}</span>` : ''}
          ${e.verified ? '<span class="rel-verified">✓</span>' : ''}
          ${e.note ? `<p class="rel-note">${esc(e.note)}</p>` : ''}</li>`;
      }).join('')}</ul></div>`;

    const areaGroup = em => {
      const items = p.areas.filter(a => a.emphasis === em);
      return items.length ? `<div class="area-group"><h4>${em === 'primary' ? 'Principal' : em === 'secondary' ? 'Also practises' : 'Occasional'}</h4>
        <div class="tags">${items.map(a => `<a class="tag ${em}" href="${listHref({ 'practice-area': a.root_slug })}">${esc(a.name)}</a>`).join('')}</div></div>` : '';
    };

    return `<div class="profile">
      <header class="profile-head"><div>
        <h1>${esc(name(p))}</h1>
        <p class="badges">
          ${p.senior ? `<span class="badge senior">Senior Advocate${p.senior_year ? ' ' + p.senior_year : ''}</span>` : ''}
          ${p.aor ? `<span class="badge aor">AoR${p.aor_year ? ' ' + p.aor_year : ''}</span>` : ''}
          ${p.status !== 'practising' ? `<span class="badge status">${esc(p.status.replace(/_/g, ' '))}</span>` : ''}
          <span class="vtag ${vc}" title="${esc(vh)}">${vl}</span></p>
        <p class="meta">${[TITLES[p.designation] || p.designation,
          p.years != null ? p.years + ' years at the Bar (since ' + p.since + ')' : null,
          p.batch ? `<a href="${listHref({ batch: String(p.batch) })}">Class of ${p.batch}</a>` : null,
          p.city ? `<a href="${listHref({ city: p.city })}">${esc(p.city)}</a>` : null].filter(Boolean).join(' · ')}</p>
        ${p.headline ? `<p class="headline">${esc(p.headline)}</p>` : ''}${signals(p)}
      </div>
      <div class="profile-actions">
        ${edgesFor(p.slug).length ? `<a class="button" href="#/net/${esc(p.slug)}">Network</a>` : ''}
      </div></header>

      ${p.direct === 0 ? `<p class="engagement warn"><strong>Not engaged directly.</strong>
        ${p.senior ? 'A Senior Advocate is instructed by an Advocate-on-Record or an instructing advocate.'
                   : 'Instructions come through an instructing advocate.'}</p>` : ''}

      <div class="profile-grid">
        <div class="profile-main">
          ${p.notes && p.notes.length ? sec('Notes', `<ul class="note-list">${p.notes.map(n =>
            `<li><div class="note-top"><span class="note-kind k-${esc(n.kind)}">${esc(n.kind)}</span>
             <span class="meta">${esc(n.occurred_on || (n.created_at || '').slice(0, 10))}</span></div>
             <p>${esc(n.body)}</p></li>`).join('')}</ul>`, 'notes') : ''}
          ${sec('About', [p.short_bio, p.long_bio].filter(Boolean).map(t => `<p>${esc(t)}</p>`).join(''))}
          ${sec('Practice areas', ['primary', 'secondary', 'occasional'].map(areaGroup).join(''))}
          ${sec('Courts and forums', p.courts.length ? `<ul class="court-list">${p.courts.map(c =>
            `<li class="freq-${esc(c.frequency)}"><a href="${listHref({ court: c.slug })}">${esc(c.name)}</a>
             <span class="freq">${esc(c.frequency)}</span>
             ${c.since_year ? `<span class="since">since ${c.since_year}</span>` : ''}
             ${c.requires_aor ? '<span class="aor-note">AoR required to file</span>' : ''}</li>`).join('')}</ul>` : '')}
          ${sec('Relationships', Object.keys(byCat).length
            ? ['chamber', 'family', 'professional', 'firm', 'education', 'court'].map(relBlock).join('') : '', 'relationships')}
          ${sec('Publications', plain(p.publications, x =>
            `<li>${x.url ? `<a href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}
             <span class="meta">${[x.venue, x.year].filter(Boolean).map(esc).join(', ')}</span></li>`))}
        </div>
        <aside class="profile-side">
          ${sec('At the Bar', dl([
            ['Bar Council', esc(p.bar_council)], ['Enrolment', esc(p.enrolment)],
            ['Enrolled', p.enrolment_year],
            ['Designated', p.senior_year], ['AoR since', p.aor_year],
            ['Fee band', p.fee_band ? esc(FEE[p.fee_band] || p.fee_band) : null],
          ]))}
          ${sec('Chambers and firms', plain(p.affiliations, a =>
            `<li><a href="${listHref({ chamber: a.slug })}">${esc(a.name)}</a>
             <span class="meta">${esc((a.role || '').replace(/_/g, ' '))}${range(a.start_year, a.end_year) ? ' · ' + range(a.start_year, a.end_year) : ''}</span></li>`))}
          ${sec('Education', plain(p.education, e =>
            `<li><a href="${listHref({ 'law-school': e.slug })}">${esc(e.name)}</a>
             <span class="meta">${[e.degree, e.field, e.end_year].filter(Boolean).map(esc).join(' · ')}</span></li>`))}
          ${sec('Positions held', plain(p.positions, x =>
            `<li>${esc(x.title)}<span class="meta">${[x.body, range(x.start_year, x.end_year)].filter(Boolean).map(esc).join(' · ')}</span></li>`))}
          ${sec('Clerkships', plain(p.clerkships, c =>
            `<li>${c.judge_slug ? `<a href="#/person/${esc(c.judge_slug)}">${esc(c.judge_name)}</a>` : esc(c.judge_name || 'Judge')}
             <span class="meta">${[c.court_name, range(c.start_year, c.end_year)].filter(Boolean).map(esc).join(' · ')}</span></li>`))}
          ${sec('Languages', p.languages.length ? `<div class="tags">${p.languages.map(l =>
            `<a class="tag" href="${listHref({ language: l.slug })}">${esc(l.name)}</a>`).join('')}</div>` : '')}
          ${sec('Credentials', plain(p.credentials, c =>
            `<li>${esc(c.name)}<span class="meta">${[c.issuer, c.year].filter(Boolean).map(esc).join(' · ')}</span></li>`))}
          ${p.interns ? sec('Internships', `<p>${esc(p.intern_note || 'Takes interns.')}</p>`) : ''}
          ${sec('Contact', plain(p.contacts, c =>
            `<li><span class="ckind">${esc(c.kind.replace(/_/g, ' '))}</span> ${esc(c.value)}</li>`))}
          ${sec('Where this came from', p.sources.length ? plain(p.sources, s =>
            `<li>${s.url ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.title || s.url)}</a>` : esc(s.title || s.kind)}
             <span class="meta">${esc((s.kind || '').replace(/_/g, ' '))}${s.retrieved_at ? ' · ' + esc(s.retrieved_at) : ''}</span>
             ${s.note ? `<span class="meta">${esc(s.note)}</span>` : ''}</li>`)
            : '<p class="meta">No source recorded.</p>')}
        </aside>
      </div></div>`;
  }

  function viewNetwork(p) {
    return `<div class="network-page">
      <header class="network-head">
        <h1>${esc(name(p))} — network</h1>
        <p class="meta"><a href="#/person/${esc(p.slug)}">Back to profile</a></p>
        <ul class="legend">${Object.entries(REL_CATS).map(([k, l]) =>
          `<li><i class="k-${k}"></i>${esc(l)}</li>`).join('')}</ul>
      </header>
      <div id="graph"></div>
      <p class="meta hint">Drag to reposition · click a node to open the profile · scroll to zoom</p>
    </div>`;
  }

  // --- graph ----------------------------------------------------------------
  function mountGraph(rootSlug) {
    const host = document.getElementById('graph');
    if (!host) return;
    const seen = new Map([[rootSlug, 0]]);
    let frontier = [rootSlug];
    for (let d = 1; d <= 2; d++) {
      const next = [];
      for (const s of frontier) for (const e of edgesFor(s)) {
        if (!seen.has(e.other)) { seen.set(e.other, d); next.push(e.other); }
      }
      frontier = next;
    }
    const nodes = [...seen.keys()].filter(s => BY_SLUG.has(s)).map((s, i) => {
      const p = BY_SLUG.get(s);
      return { slug: s, name: p.name, headline: p.headline, city: p.city, depth: seen.get(s),
               senior: p.senior, aor: p.aor, i,
               r: s === rootSlug ? 13 : p.senior ? 10 : p.aor ? 8.5 : 7,
               x: Math.cos(i) * (seen.get(s) * 110), y: Math.sin(i) * (seen.get(s) * 110),
               vx: 0, vy: 0 };
    });
    const idx = new Map(nodes.map(n => [n.slug, n]));
    const links = DATA.relationships
      .filter(r => idx.has(r.from) && idx.has(r.to))
      .map(r => ({ s: idx.get(r.from), t: idx.get(r.to), category: r.category, strength: r.strength || 3 }));
    runForce(host, nodes, links, rootSlug);
  }

  function runForce(host, nodes, links, rootSlug) {
    const COLOUR = { chamber: '#7b2d26', professional: '#9a7b31', firm: '#2f6b47',
                     education: '#3c5a8a', court: '#6b4a7a', family: '#b06a3a' };
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const INK = dark ? '#ece7df' : '#1c1a17', MUTED = dark ? '#857e74' : '#8a8279';
    const canvas = document.createElement('canvas');
    host.innerHTML = ''; host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, alpha = 1, hovered = null, dragging = null, panning = null;
    const view = { x: 0, y: 0, k: 1 };
    const dpr = devicePixelRatio || 1;

    function resize() {
      W = host.clientWidth; H = host.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const screenOf = n => ({ x: n.x * view.k + view.x + W / 2, y: n.y * view.k + view.y + H / 2 });

    function step() {
      for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
        const p = nodes[a], q = nodes[b];
        const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2), f = 5200 / d2;
        p.vx -= dx / d * f; p.vy -= dy / d * f; q.vx += dx / d * f; q.vy += dy / d * f;
      }
      for (const l of links) {
        const target = 120 - l.strength * 9;
        const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.hypot(dx, dy) || 0.01;
        const f = (d - target) * 0.02;
        l.s.vx += dx / d * f; l.s.vy += dy / d * f; l.t.vx -= dx / d * f; l.t.vy -= dy / d * f;
      }
      for (const n of nodes) {
        if (n === dragging) continue;
        n.vx += -n.x * 0.006; n.vy += -n.y * 0.006;
        n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx * alpha; n.y += n.vy * alpha;
      }
      alpha = Math.max(0.05, alpha * 0.995);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (const l of links) {
        const a = screenOf(l.s), b = screenOf(l.t);
        ctx.strokeStyle = COLOUR[l.category] || MUTED;
        ctx.globalAlpha = hovered && hovered !== l.s && hovered !== l.t ? 0.12 : 0.55;
        ctx.lineWidth = Math.max(1, l.strength * 0.45) * view.k;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        const p = screenOf(n), r = n.r * view.k;
        const near = !hovered || hovered === n || links.some(l =>
          (l.s === hovered && l.t === n) || (l.t === hovered && l.s === n));
        ctx.globalAlpha = near ? 1 : 0.25;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.slug === rootSlug ? '#7b2d26' : n.senior ? '#9a7b31'
          : n.aor ? '#3c5a8a' : (dark ? '#4a453e' : '#c9c2b7');
        ctx.fill();
        ctx.strokeStyle = dark ? '#1f1e1b' : '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        if (view.k > 0.55 || n.slug === rootSlug || n === hovered) {
          ctx.fillStyle = n === hovered ? INK : MUTED;
          ctx.font = (n === hovered || n.slug === rootSlug ? '600 ' : '') +
            Math.max(10, 11 * view.k) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(n.name, p.x, p.y + r + 12);
        }
      }
      ctx.globalAlpha = 1;
    }

    const rel = e => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    const pick = (mx, my) => {
      let best = null, bd = 18;
      for (const n of nodes) {
        const p = screenOf(n), d = Math.hypot(p.x - mx, p.y - my);
        if (d < Math.max(bd, n.r * view.k + 6)) { best = n; bd = d; }
      }
      return best;
    };
    canvas.addEventListener('mousemove', e => {
      const [mx, my] = rel(e);
      if (dragging) { dragging.x = (mx - W / 2 - view.x) / view.k; dragging.y = (my - H / 2 - view.y) / view.k; alpha = Math.max(alpha, 0.5); }
      else if (panning) { view.x += mx - panning[0]; view.y += my - panning[1]; panning = [mx, my]; }
      else { const h = pick(mx, my); if (h !== hovered) { hovered = h; canvas.style.cursor = h ? 'pointer' : 'grab'; } }
    });
    canvas.addEventListener('mousedown', e => { const [mx, my] = rel(e); const n = pick(mx, my); if (n) dragging = n; else panning = [mx, my]; });
    addEventListener('mouseup', () => { dragging = null; panning = null; });
    canvas.addEventListener('click', e => { const n = pick(...rel(e)); if (n) location.hash = '#/person/' + n.slug; });
    canvas.addEventListener('wheel', e => { e.preventDefault(); view.k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); }, { passive: false });
    addEventListener('resize', resize);
    resize();
    (function loop() { if (!document.body.contains(canvas)) return; step(); draw(); requestAnimationFrame(loop); })();
  }

  // --- events ---------------------------------------------------------------
  function wire() {
    for (const form of document.querySelectorAll('[data-search]')) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        const r = parseHash();
        location.hash = listHref(r.dims, { q: form.querySelector('input').value, sort: r.sort });
      });
    }
    const sort = document.querySelector('[data-sort]');
    if (sort) sort.addEventListener('change', () => {
      const r = parseHash();
      location.hash = listHref(r.dims, { q: r.q, sort: sort.value });
    });
  }

  addEventListener('hashchange', render);
  render();
})();
