// ============================================================================
// Parse a Supreme Court daily cause list into advocate appearances.
//
// A cause list is a table: serial number, case number, the parties, and against
// each party the advocate on record, tagged with which party they act for —
// "NEHA RATHI [R-1], [R-5]". That tag is the whole reason this is worth
// scraping: it says who appeared, for whom, in which case, before which Bench,
// on which day. Nothing else in the public record says that.
//
// The extractor gives back lines, and a name can wrap across a line or across a
// page break, so names are accumulated into a buffer and resolved against the
// roll of Advocates-on-Record when a tag closes them. Matching against the roll
// rather than trying to delimit the name perfectly is what makes this robust:
// the cause list names AoRs, and the roll is the list of AoRs.
// ============================================================================

/** Party tags the Registry actually uses. Anything else in brackets is prose. */
const TAG_SRC = String.raw`\[(?:P-\d+|R-\d+(?:\.\d+)?|CAVEAT|INT|IMPL|PR|GR|AMICUS CURIAE)\]`;
const TAG_RUN = new RegExp(`((?:${TAG_SRC}[,\\s]*)+)`);
const IS_TAG = new RegExp(`^${TAG_SRC}`);
const TAG_ONE = new RegExp(TAG_SRC.replace(/^\\\[/, '\\[').slice(0), 'g');

// Repeated page headers. Skipping these must NOT reset the name buffer — a name
// routinely wraps across a page break, and clearing here loses it.
const FURNITURE = /^(SNo\.|Case No\.|Petitioner ?\/ ?Respondent|Advocate$|DAILY CAUSE LIST|SUPREME COURT OF INDIA|HON.BLE|\(TIME|NOTE ?:|•|\[ ?IT WILL|ON RECORD DO NOT|LISTED BEFORE ALL)/i;

// Real breaks between one party's advocates and the next.
const BOUNDARY = /^(Versus$|MISCELLANEOUS HEARING$|REGULAR HEARING$|\{)/i;

const COURT = /^(COURT NO\.?\s*:?\s*\d+|CHIEF JUSTICE'S COURT|REGISTRAR(?:'S)? COURT[^\]]*)$/i;
// MRS. and MS. must be tried before MR., or "MRS." leaves an "S." behind.
const JUDGE = /^HON'BLE\s+(?:MRS\.?|MS\.?|MR\.?|DR\.?|THE)\s*(?:JUSTICE)?\s*(.+?)\s*$/i;
const SERIAL = /^\d{1,4}$/;
const CASE_NO = /^(?:[A-Za-z.()\/\s]{1,24})?(?:No\.|NO\.)\s*\d[\d\s\-–\/]*\/\s*\d{4}$/;
const DIARY = /^Diary No\.\s*[\d\/\s-]+$/i;

export const normaliseName = s => String(s ?? '').toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Build a lookup from the AoR roll (and any other people you want matched).
 * `entries` is [{ slug, full_name }].
 */
export function nameIndex(entries) {
  const idx = new Map();
  for (const e of entries) {
    // Derived overlays carry a slug and nothing else; they have no name to match.
    if (!e?.slug || !e.full_name) continue;
    const k = normaliseName(e.full_name);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(e.slug);
  }
  return idx;
}

function sideOf(tags) {
  if (tags.some(t => /^P-/.test(t))) return 'petitioner';
  if (tags.some(t => /^R-/.test(t))) return 'respondent';
  if (tags.includes('CAVEAT')) return 'caveator';
  if (tags.includes('AMICUS CURIAE')) return 'amicus';
  return 'other';
}

/**
 * @param text  plain text of one cause-list PDF
 * @param index name -> [slug] from nameIndex()
 * @returns { appearances, unmatched, stats }
 */
export function parseCauseList(text, index, { date = null, list = null } = {}) {
  const lines = text.split('\n').map(l => l.trim());
  const appearances = [];
  const unmatched = new Map();

  let court = null, judges = [], caseNo = null, item = null;
  let buf = '', awaitingCase = false, last = null;
  let tagged = 0;

  const close = tagRun => {
    const tags = (tagRun.match(new RegExp(TAG_SRC, 'g')) || [])
      .map(t => t.slice(1, -1));
    if (!tags.length) return;

    if (!buf.trim()) {
      // A continuation of the previous advocate's tag list, wrapped onto a new
      // line. It is not a new appearance.
      if (last) for (const t of tags) if (!last.tags.includes(t)) last.tags.push(t);
      return;
    }
    tagged++;

    // Longest suffix of the buffer that is a name on the roll. The prefix is
    // the party name, which we do not need and must not mistake for counsel.
    const words = normaliseName(buf).split(' ').filter(Boolean);
    let matchedName = null, slugs = null;
    for (let i = 0; i < words.length; i++) {
      const cand = words.slice(i).join(' ');
      if (index.has(cand)) { matchedName = cand; slugs = index.get(cand); break; }
    }
    const raw = words.slice(-8).join(' ');
    if (!matchedName) unmatched.set(raw, (unmatched.get(raw) || 0) + 1);

    const rec = {
      date, list, court, judges: [...judges], item, case: caseNo,
      name: matchedName || raw,
      // More than one person on the roll carries this name: recording a single
      // slug would be a guess, so the ambiguity is carried through instead.
      slug: slugs && slugs.length === 1 ? slugs[0] : null,
      candidates: slugs && slugs.length > 1 ? slugs : undefined,
      matched: !!matchedName,
      tags, side: sideOf(tags),
    };
    appearances.push(rec);
    last = rec;
    buf = '';
  };

  for (const line of lines) {
    if (!line) continue;

    const c = line.match(COURT);
    if (c) {
      const next = c[1].replace(/\s+/g, ' ');
      // The court heading repeats on every page of that court's section; only a
      // genuine change of court starts a new Bench.
      if (next !== court) { court = next; judges = []; }
      buf = ''; last = null; continue;
    }
    const j = line.match(JUDGE);
    if (j && !FURNITURE.test(line.replace(/^HON'BLE.*/, ''))) {
      const name = j[1].replace(/^JUSTICE\s+/i, '').trim();
      if (name && !judges.includes(name)) judges.push(name);
      continue;
    }
    if (FURNITURE.test(line)) continue;                  // page header: keep buf
    if (BOUNDARY.test(line)) { buf = ''; last = null; continue; }

    if (SERIAL.test(line)) { item = Number(line); awaitingCase = true; buf = ''; last = null; continue; }
    if (awaitingCase && (CASE_NO.test(line) || DIARY.test(line))) {
      caseNo = line.replace(/\s+/g, ' '); awaitingCase = false; buf = ''; continue;
    }

    for (const part of line.split(TAG_RUN)) {
      if (!part) continue;
      if (IS_TAG.test(part.trim())) close(part);
      else buf += ' ' + part;
    }
  }

  return {
    appearances,
    unmatched: [...unmatched].sort((a, b) => b[1] - a[1]),
    stats: {
      tagged,
      matched: appearances.filter(a => a.matched).length,
      ambiguous: appearances.filter(a => a.candidates).length,
      items: new Set(appearances.map(a => a.case)).size,
      benches: new Set(appearances.map(a => a.court)).size,
    },
  };
}
