# Data dictionary — import record shape

`scripts/import-json.js` reads a single JSON object with four top-level keys
(`_note` and `_review` are ignored, so generated files can carry their own
provenance):
`organisations`, `people`, `relationships`, `matters`. All are optional; all
cross-references are by **slug**, and an unknown slug is a hard error (except for
relationship endpoints, which are skipped and reported).

The import is **idempotent on slug**: re-running updates the existing record.
Child rows (practice areas, courts, education, affiliations…) are replaced
wholesale, so the file is the record of truth for those.

```bash
npm run import -- data/your-file.json --source-kind=bar_council_roll
```

`--source-kind` sets the default provenance for records that don't carry their
own `sources` array. Valid: `self_declared`, `bar_council_roll`, `court_record`,
`judgment`, `cause_list`, `firm_website`, `professional_profile`, `news`,
`directory`, `manual_entry`, `synthetic`.

---

## `organisations[]`

| Field | Type | Notes |
|---|---|---|
| `slug` | string, **required** | Stable identifier |
| `name` | string, required | |
| `type` | enum, required | `chamber`, `law_firm`, `in_house`, `government`, `psu`, `ngo`, `legal_aid`, `tribunal_panel`, `academic`, `other` |
| `head_person` | slug | Resolved on a second pass, so it may point forward to a person in the same file |
| `city`, `state` | string | |
| `website` | url | |
| `founded_year` | int | |
| `size_band` | enum | `solo`, `2-5`, `6-15`, `16-50`, `51-200`, `200+` |
| `description` | string | |

## `people[]`

### Identity

| Field | Type | Notes |
|---|---|---|
| `slug` | string, **required** | |
| `full_name` | string, **required** | |
| `preferred_name`, `honorific` | string | `honorific` renders before the name |
| `pronouns` | string | Populate **only** from a self-declaration. Never infer from a name |

### Standing at the Bar

| Field | Type | Notes |
|---|---|---|
| `designation` | enum | `advocate` (default), `senior_advocate`, `advocate_on_record`, `senior_advocate_aor`, `solicitor`, `judge`, `retired_judge`, `academic`, `in_house_counsel`, `other` |
| `is_senior_advocate` | bool | Defaults from `designation` |
| `senior_designated_year` | int | |
| `senior_designating_court` | court slug | Which court designated them |
| `is_aor` | bool | Supreme Court Advocate-on-Record. Defaults from `designation` |
| `aor_year`, `aor_code` | int / string | |
| `bar_council` | bar_council slug | |
| `enrolment_number` | string | e.g. `D/2287/2004` |
| `enrolment_year` | int | |
| `first_year_of_practice` | int | Drives `years_experience`. Falls back to `enrolment_year` |
| `class_of` | int | Graduating batch. Drives browse-by-batch. If omitted, `batch_year` falls back to the earliest `education.end_year` |
| `status` | enum | `practising` (default), `on_bench`, `retired`, `inactive`, `deceased`. Deceased records are excluded from screens unless asked for |

### Place and practice

| Field | Type | Notes |
|---|---|---|
| `primary_court` | court slug | |
| `primary_organisation` | organisation slug | |
| `base_city`, `base_state`, `country` | string | `country` defaults to `India` |
| `headline` | string | One line, shown on cards |
| `short_bio`, `long_bio` | string | |
| `photo_url` | url | |

### Engagement signals

These are what Phases 2 and 4 read.

| Field | Type | Notes |
|---|---|---|
| `accepts_interns` | bool | |
| `intern_intake_note` | string | Free text: timing, how to apply, what to expect |
| `accepts_direct_briefs` | bool | **Set `false` for Senior Advocates** — they are instructed through an AoR or instructing advocate. Leave unset if unknown; the profile then says nothing |
| `takes_pro_bono` | bool | |
| `legal_aid_panel` | bool | |
| `fee_band` | enum | `legal_aid`, `modest`, `mid`, `premium`, `senior_counsel`, `unknown`. Self-declared bands only — never a precise figure |
| `available_for_mentoring` | bool | |

### Trust

| Field | Type | Notes |
|---|---|---|
| `verification_status` | enum | `unverified` (default) → `source_backed` → `self_claimed` → `bar_verified` |
| `visibility` | enum | `public` (default), `limited`, `hidden`. Non-public records never appear in screens or graphs |

### Child collections

```jsonc
"practice_areas": [
  { "slug": "arbitration",        // practice_area slug, required
    "emphasis": "primary",        // primary | secondary | occasional (default secondary)
    "years_active": 12,
    "evidence_note": "..." }
],

"courts": [
  { "slug": "bombay-hc",          // court slug, required
    "frequency": "primary",       // primary | regular | occasional (default regular)
    "since_year": 2013,
    "note": "..." }
],

"languages": [
  { "code": "mr",                 // language code, required
    "proficiency": "native" }     // native | fluent | working | reading
],

"education": [
  { "institution": "nls-bengaluru",   // institution slug, required
    "degree": "B.A. LL.B. (Hons.)",
    "field": "…", "start_year": 1999, "end_year": 2004, "distinction": "…" }
],

"affiliations": [
  { "organisation": "chambers-prabhu",  // organisation slug, required
    "role": "chamber_junior",           // see roles below, required
    "start_year": 2013, "end_year": 2019, "is_current": false, "note": "…" }
],

"positions": [
  { "title": "Amicus Curiae", "body": "Supreme Court of India",
    "court": "supreme-court-of-india", "start_year": 2019, "end_year": 2021, "note": "…" }
],

"clerkships": [
  { "judge_person": "s-ramaswamy-iyer",  // person slug, if the judge is in the directory
    "judge_name": "…",                   // otherwise a plain name
    "court": "supreme-court-of-india", "start_year": 2019, "end_year": 2020 }
],

"credentials": [
  { "kind": "accreditation",      // qualification | accreditation | panel | bar_admission | other
    "name": "FCIArb", "issuer": "CIArb", "year": 2013 }
],

"publications": [{ "title": "…", "venue": "…", "year": 2022, "url": "…" }],
"awards":       [{ "name": "…", "awarded_by": "…", "year": 2020 }],

"contacts": [
  { "kind": "chambers_address",   // chambers_address | office_address | email | phone |
                                  // clerk_name | clerk_phone | website | profile_url | other
    "label": "…", "value": "…",
    "is_public": true }           // defaults to false — private unless explicitly opted in
],

// Private notes. NOT wiped on re-import — these are your own words. Imported
// notes are deduplicated on `body`, so re-running an import is safe.
// Never included in JSON API output.
"notes": [
  { "kind": "impression",         // note | impression | hearsay | met | todo | source
    "body": "…",                  // required
    "occurred_on": "2026-03-14",  // when the thing happened, if that matters
    "pinned": false }
  // a bare string is also accepted and becomes kind "note"
],

"sources": [
  { "kind": "firm_website", "title": "…", "url": "…",
    "retrieved_at": "2026-07-28", "note": "…",
    "field": "senior_designated_year" }   // optional: which field this source backs
]
```

**Affiliation roles:** `intern`, `law_clerk`, `chamber_junior`, `junior_counsel`,
`associate`, `senior_associate`, `principal_associate`, `counsel`, `of_counsel`,
`partner`, `equity_partner`, `founder`, `founding_partner`, `managing_partner`,
`head_of_chambers`, `standing_counsel`, `panel_counsel`, `in_house`, `other`.

## `relationships[]`

```jsonc
{ "from": "meher-barucha",          // person slug, required
  "to":   "vasudha-raghunathan",    // person slug, required
  "type": "former_chamber_junior_of", // relationship_type code, required
  "organisation": "chambers-raghunathan",  // where it arose
  "institution":  "nls-bengaluru",         // for education ties
  "court":        "supreme-court-of-india",
  "start_year": 2004, "end_year": 2009,
  "strength": 5,        // 1-5, how close / how confident (default 3)
  "verified": true,
  "note": "…" }
```

Direction matters. Write the edge from the junior's point of view; the inverse is
resolved automatically when the other profile is rendered.

| Category | Codes |
|---|---|
| chamber | `chamber_junior_of` ↔ `mentor_of` · `former_chamber_junior_of` ↔ `former_mentor_of` · `co_junior_with` (symmetric) · `successor_in_chamber_of` ↔ `predecessor_in_chamber_of` |
| firm | `partner_of`, `colleague_of`, `founded_with` (all symmetric) |
| education | `taught_by` ↔ `taught` · `classmate_of`, `alumnus_peer_of`, `moot_partner_of` (symmetric) |
| court | `law_clerk_to` ↔ `had_law_clerk` |
| professional | `briefs` ↔ `briefed_by` · `leads` ↔ `led_by` · `co_counsel_with`, `opposed` (symmetric) |
| family | `spouse_of` (symmetric) · `parent_of` ↔ `child_of` · `sibling_of` (symmetric) · `grandparent_of` ↔ `grandchild_of` · `uncle_aunt_of` ↔ `nephew_niece_of` · `cousin_of` (symmetric) · `in_law_of` (symmetric) · `relative_of` (symmetric) |

Family labels are **gender-neutral**: `parent_of` rather than father/mother,
`uncle_aunt_of` rather than uncle, `grandchild_of` rather than grandson. The
schema does not record anyone's gender and must not infer it from a name. Put
the exact relation in the edge's `note` — `"note": "her grandson"` — where it
comes from something you actually know.

`briefs`/`briefed_by` models the AoR relationship: the AoR *briefs* the Senior
Advocate. `leads`/`led_by` models a junior appearing with leading counsel.

Only `chamber_junior_of` and `former_chamber_junior_of` are traversed by
`chamber_lineage_of`. Every type is traversed by `connected_to`.

## `matters[]`

```jsonc
{ "title": "Sharma v. Union of India",
  "citation": "(2022) 9 SCC 441",
  "court": "supreme-court-of-india",
  "year": 2022,
  "practice_area": "service-constitutional",
  "outcome": "Petition allowed",
  "summary": "…", "url": "…",
  "counsel": [
    { "person": "vasudha-raghunathan", "role": "senior_counsel", "side": "Petitioner" },
    { "person": "meher-barucha",       "role": "aor",            "side": "Petitioner" }
  ] }
```

Counsel roles: `arguing_counsel`, `senior_counsel`, `aor`, `briefing_counsel`,
`junior_counsel`, `amicus`, `intervenor_counsel`, `other`.

Matters are deduplicated on `(title, year)`. In Phase 3 this table becomes the
source from which `co_counsel_with` and `led_by` edges are *derived* rather than
hand-entered.

## The NLS RTF converter

`scripts/convert-nls-rtf.js` turns a hand-written RTF list into a file matching
the shape above.

```bash
npm run convert:nls -- "NLS Alum list.rtf" data/nls-alumni.json
npm run import -- data/nls-alumni.json
```

It expects the list's own structure: `In <City>` headings, category headings
(`Judges`, `Litigators`, `Lawyers`, `Transactions`, `Others (Academics)`), and
numbered entries. Within an entry it reads:

| In the list | Becomes |
|---|---|
| `Justice C Saravanan ('94)` | `honorific: Justice`, `designation: judge`, `class_of: 1994` |
| `(Sr. Adv, NLS 1998)` | `designation: senior_advocate`, `class_of: 1998` |
| `(2006 grad, equity partner at SAM: Energy practice)` | `class_of: 2006`, affiliation `SAM` as `equity_partner`, practice area `energy-infrastructure` |
| `(Fidus Law chambers: IP litigator, 2008 grad)` | affiliation `Fidus Law chambers`, practice area `ip-technology`, `class_of: 2008` |
| `; Haripriya's Spouse` | `spouse_of` edge, first name resolved against the list |
| `; KK Venugopal's Junior` | `former_chamber_junior_of` edge |
| `; Junior to X and to Y` | two `former_chamber_junior_of` edges |
| `Mahesh Devaiah, PM Thimmiah (MD&T Partners)` | two people, one shared firm |

Deliberate limits:

- **It never invents a practice area** from a section heading. "Listed under
  Litigators" becomes a note, not a `criminal` tag.
- **Anything it cannot parse becomes a note**, verbatim, rather than being
  dropped or guessed at.
- **Every record is `unverified`** and carries the RTF as its `source`.
- **People mentioned only as a relation** get stub records, flagged in a note.

It prints a review log — and writes the same list to `_review` in the output —
covering split names, firm abbreviations kept as-is, first-name matches, stub
records, and ambiguous section structure. Read it before importing.

## The firm deal-database converter

`scripts/convert-firm-db.js` turns the Bar & Bench deal-coverage SQLite file
into the same shape.

```bash
npm run convert:firms -- "/path/to/legal_directory.db" data/firm-partners.json
npm run import -- data/firm-partners.json
```

| In the source | Becomes |
|---|---|
| `people.role = "Partner, Head Competition"` | affiliation `role: partner`, full title kept in the affiliation `note`, `headline: "Partner, Head Competition, <firm>"` |
| `firms.name` | an `organisation` of type `law_firm` |
| `deal_practice_areas.area` on a deal the person is named on | a `practice_areas` entry; the most frequent becomes `primary` |
| `deals` | a `matter` with client, deal type, snippet, URL, and a `counsel` entry per named partner |
| two partners on the same deal | `colleague_of` (same firm) or `co_counsel_with` (different firms) |
| `deals.url` | a `source` of kind `news` |

Deliberate limits, mirroring the NLS converter:

- **Bar Council, enrolment, year of call, city and languages are left empty** —
  a deal report does not contain them.
- **Practice areas come only from a tagged deal**, never from a job title or a
  firm's reputation.
- **Two records sharing a name are never merged**, whether the collision is
  inside the source or against another file in `data/`. Both get suffixed slugs
  and a note explaining the ambiguity.
- **Associates are excluded** unless `--include-associates` is passed.
- A co-appearance edge asserts co-appearance and nothing else — no mentorship
  or seniority is inferred from it.

Practice-area tags map onto six slugs, one of which — `private-equity-vc` — this
import added to `db/02-taxonomy.sql`.

## Extending the taxonomy

Courts, practice areas, institutions, Bar Councils, languages and relationship
types are reference data in `db/02-taxonomy.sql`. Adding one means adding an
`INSERT` there and rebuilding, or inserting directly into the live database —
they are plain tables with slug uniqueness, nothing more.

`GET /api/taxonomy` returns every current value, which is the quickest way to
find the slug you need while preparing an import file.
