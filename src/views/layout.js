// Server-rendered HTML. No template engine, no build step.

export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const NAV = [
  ['/', 'Browse'],
  ['/directory', 'Directory'],
  ['/screener', 'Screener'],
  ['/chambers', 'Chambers'],
  ['/network', 'Network'],
  ['/notes', 'My notes'],
];

export function layout({ title, body, active = '', head = '', script = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Advocates</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>⚖️</text></svg>">
${head}
</head>
<body>
<header class="site">
  <a class="brand" href="/">⚖️ <span>Advocates</span></a>
  <nav>${NAV.map(([href, label]) =>
    `<a href="${href}"${active === href ? ' class="on"' : ''}>${label}</a>`).join('')}</nav>
  <form class="topsearch" method="get" action="/directory">
    <input type="search" name="q" placeholder="Search names, bios…" aria-label="Search">
  </form>
</header>
<div class="private-banner">
  <strong>Private working copy.</strong> Notes are yours alone and are excluded from every export.
  Records marked <em>unverified</em> came from a personal list, not a checked source.
</div>
<main>${body}</main>
<footer>
  <p>Phase 1 — see <code>ROADMAP.md</code>. Any screen as JSON: append <code>format=json</code>.</p>
</footer>
${script}
</body>
</html>`;
}

// --- shared vocabulary ------------------------------------------------------

export const TITLES = {
  advocate: 'Advocate',
  senior_advocate: 'Senior Advocate',
  advocate_on_record: 'Advocate-on-Record',
  senior_advocate_aor: 'Senior Advocate & AoR',
  solicitor: 'Solicitor',
  judge: 'Judge',
  retired_judge: 'Retired Judge',
  academic: 'Academic',
  in_house_counsel: 'In-house Counsel',
  other: 'Other',
};

export const VERIFICATION = {
  unverified:   { label: 'Unverified', cls: 'v-none', hint: 'No checked source behind this record.' },
  source_backed:{ label: 'Source-backed', cls: 'v-source', hint: 'Entered from a cited public source.' },
  self_claimed: { label: 'Self-claimed', cls: 'v-claim', hint: 'Confirmed by the advocate.' },
  bar_verified: { label: 'Bar-verified', cls: 'v-bar', hint: 'Checked against Bar Council records.' },
};

export const FEE_BANDS = {
  legal_aid: 'Legal aid', modest: 'Modest', mid: 'Mid', premium: 'Premium',
  senior_counsel: 'Senior counsel', unknown: 'Not stated',
};

export const NOTE_KINDS = {
  note: 'Note', impression: 'Impression', hearsay: 'Heard that',
  met: 'Met', todo: 'To do', source: 'Source',
};

export const COURT_TYPES = {
  supreme: 'Supreme Court', high_court: 'High Courts', high_court_bench: 'High Court benches',
  district: 'District courts', sessions: 'Magistrate & sessions', tribunal: 'Tribunals',
  commission: 'Commissions', regulator: 'Regulators', arbitral: 'Arbitration',
  consumer: 'Consumer forums', family: 'Family courts', labour: 'Labour courts',
  revenue: 'Revenue & rent', foreign: 'Foreign', other: 'Other',
};

export const ORG_TYPES = {
  chamber: 'Chambers', law_firm: 'Law firms', legal_aid: 'Legal aid',
  government: 'Government law offices', in_house: 'In-house', psu: 'Public sector',
  ngo: 'NGOs', academic: 'Academic', tribunal_panel: 'Tribunal panels', other: 'Other',
};

export const REL_CATEGORIES = {
  chamber: 'Chamber', firm: 'Firm', education: 'Education',
  court: 'Court', professional: 'Professional', family: 'Family',
};

export function displayName(p) {
  return [p.honorific, p.full_name].filter(Boolean).join(' ');
}

export function years(p) {
  return p.years_experience ?? (p.first_year_of_practice
    ? new Date().getFullYear() - p.first_year_of_practice : null);
}

export function badges(p) {
  const out = [];
  if (p.is_senior_advocate) out.push(`<span class="badge senior">Senior Advocate${p.senior_designated_year ? ' ' + p.senior_designated_year : ''}</span>`);
  if (p.is_aor) out.push(`<span class="badge aor">AoR${p.aor_year ? ' ' + p.aor_year : ''}</span>`);
  if (p.status && p.status !== 'practising') out.push(`<span class="badge status">${esc(p.status.replace(/_/g, ' '))}</span>`);
  return out.join('');
}

export function personCard(p) {
  const y = years(p);
  const primary = (p.practice_areas || []).filter(a => a.emphasis === 'primary').slice(0, 4);
  const courts  = (p.courts || []).slice(0, 3);
  const v = VERIFICATION[p.verification_status] || VERIFICATION.unverified;

  const facts = [
    TITLES[p.designation] || p.designation,
    y != null ? `${y} yrs` : null,
    p.batch_year ? `Class of ${p.batch_year}` : null,
    p.base_city,
  ].filter(Boolean);

  return `<article class="card">
  <div class="card-head">
    <h3><a href="/lawyer/${esc(p.slug)}">${esc(displayName(p))}</a></h3>
    ${badges(p)}
    ${p.note_count ? `<span class="note-pill" title="${p.note_count} note${p.note_count === 1 ? '' : 's'}">✎ ${p.note_count}</span>` : ''}
  </div>
  <p class="meta">${facts.map(esc).join(' · ')}
    <span class="vtag ${v.cls}" title="${esc(v.hint)}">${v.label}</span></p>
  ${p.headline ? `<p class="headline">${esc(p.headline)}</p>` : ''}
  ${primary.length || courts.length ? `<div class="tags">
    ${primary.map(a => `<a class="tag primary" href="/directory?practice_areas=${esc(a.slug)}">${esc(a.name)}</a>`).join('')}
    ${courts.map(c => `<a class="tag court" href="/directory?courts=${esc(c.slug)}">${esc(c.name)}</a>`).join('')}
  </div>` : ''}
  ${signals(p)}
</article>`;
}

export function signals(p) {
  const out = [
    p.accepts_interns && '<span class="signal intern">Takes interns</span>',
    p.accepts_direct_briefs === 0 && '<span class="signal indirect">Brief via AoR</span>',
    p.legal_aid_panel && '<span class="signal aid">Legal aid</span>',
    p.takes_pro_bono && '<span class="signal probono">Pro bono</span>',
    p.available_for_mentoring && '<span class="signal mentor">Mentors</span>',
  ].filter(Boolean);
  return out.length ? `<p class="signals">${out.join('')}</p>` : '';
}
