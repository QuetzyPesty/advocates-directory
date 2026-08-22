# Advocates — a private directory and screener

A personal, structured record of the Bar: who practises what, where they appear,
how they are connected to each other, and what I know about them.

This is **Phase 1**. The phased plan is in [ROADMAP.md](ROADMAP.md).

Zero runtime dependencies — Node 22.5+ only, using the built-in `node:sqlite`.

## Run it

```bash
npm run build && npm start
```

Opens on <http://127.0.0.1:4700>. The server binds to localhost only: this holds
private notes and must not be reachable from the network.

`npm run build` is destructive — it recreates `db/directory.sqlite` from
`db/*.sql` and reloads every dataset in `data/`.

The directory currently holds **535 people**:

| Source | People | Standing |
|---|---|---|
| Law firm partners from the deal-coverage database | 433 | `source_backed` — each cites the Bar & Bench reports naming them |
| Supreme Court advocates researched from public sources | 55 | `source_backed` — in two batches, `data/sc-advocates.json` and `data/sc-advocates-batch2.json` |
| NLS alumni list | 47 | `unverified` — a personal list, not a checked source |

Plus 48 firms and chambers, 146 reported transactions, and 3,399 relationships.

## Private by design

Phase 1 is a single-user working copy — a diary of the Bar as much as a
directory. Notes can be unreserved because nobody else can read them:

- Notes live in their own table (`person_note`), not as a column on `person`.
- They default to `is_private = 1`.
- `getProfile()` only returns them when the HTML layer asks; the JSON API never
  passes that flag, so notes cannot leak through `/api/*` by accident.
- A re-import never wipes them — imported child rows are replaced wholesale, but
  notes are yours and are deduplicated on body instead.

That separation is what lets this become something shareable in Phase 3 without
anything having to be untangled first.

## Loading the NLS alumni list

```bash
npm run convert:nls -- "NLS Alum list.rtf" data/nls-alumni.json
npm run import -- data/nls-alumni.json
```

`scripts/convert-nls-rtf.js` parses the RTF itself (no `textutil`, no
dependencies), follows the section structure — city headings, `Judges`,
`Litigators`, `Transactions`, `Others (Academics)` — and pulls out:

- **Names**, including `Justice X` (honorific split off) and shared-firm lines
  like `Mahesh Devaiah, PM Thimmiah (MD&T Partners)`
- **Batch year** from `2006 grad`, `NLS 1998`, `('94)`
- **Standing** from `Sr. Adv` and from the `Judges` heading
- **Firms** from `(K Law)`, `equity partner at SAM`, `Fidus Law chambers`
- **Practice areas** only where the list actually says one — `IP litigator`
  → IP & Technology, `Energy practice` → Energy & Infrastructure. It does not
  guess a practice area from a section heading.
- **Relationships**: `Haripriya's Spouse` → `spouse_of`,
  `KK Venugopal's Junior` and `Junior to X and to Y` →
  `former_chamber_junior_of`. People named only as a relation (KK Venugopal,
  Indu Malhotra) get stub records flagged as such.

Everything else in a parenthetical is kept verbatim as a note rather than
discarded or guessed at. Every record is written as `unverified` with the RTF as
its source.

It prints a **review log** of every inference it made — split names, firm
abbreviations, first-name matches, stub records, ambiguous section structure —
and writes the same list to `_review` in the output JSON. Read it before
trusting the import.

## Loading the firm-partner database

```bash
npm run convert:firms -- "/Users/anandiyer/structuring mbox/legal_directory.db" data/firm-partners.json
npm run import -- data/firm-partners.json
```

`scripts/convert-firm-db.js` reads the SQLite file built from Bar & Bench deal
coverage — firms, people with a free-text role, deals with a URL, and who acted
on what — and lifts the **partner-level** people out of it: partners, senior and
managing partners, equity partners, counsel and practice heads. It writes:

- **People**, headlined with their exact recorded role and firm, `source_backed`
  against the deal reports they are named in (up to six URLs each)
- **Practice areas**, counted from the tags on deals the person is actually named
  on — most-frequent area becomes `primary`, and the count is recorded in
  `evidence_note`. A partner on no tagged deal gets no area at all
- **Firms** as `law_firm` organisations, with the affiliation role mapped onto
  the schema's enum (`Senior Partner` → `partner`, `Partner, Head Competition` →
  `partner` with the full title kept in the affiliation note)
- **Matters** — 146 reported transactions with client, deal type, summary and URL
- **Relationships** derived only from having acted on the same transaction:
  `colleague_of` within a firm, `co_counsel_with` across firms, strength scaled
  by how many matters the pair shares

What it refuses to do:

- **No invented biography.** Bar Council, enrolment number, year of call, city
  and languages are not in a deal write-up, so those fields stay empty.
- **No practice area from a job title or a firm.** Only from a tagged deal.
- **No identity merging.** Where the source has the same name at two firms it
  writes two records with suffixed slugs and a note on each saying so — that may
  be a lateral move, a misattribution, or two people, and the data cannot tell.
  The same applies to a name already present in another dataset.
- **No seniority claimed** from a co-appearance edge. Acting together is all it
  means.

Associates are excluded by default (584 of them). Pass `--include-associates` to
bring the whole ladder in.

It prints a review log and writes it to `_review` in the output JSON. Read it
before importing.

## Ways in

**Browse** (`/`) is the front door. Ten dimensions, each listing every value in
use with a count, opening straight into the filtered directory:

| | |
|---|---|
| Practice area | What they do |
| Court or forum | Where they appear |
| City · State | Where they are based |
| Law school | Where they studied |
| Batch | Year they graduated |
| Chamber or firm | Who they work with |
| Standing | Rank at the Bar |
| Language | What they can appear in |
| Bar Council | Where they are enrolled |
| Relationship | How they are connected |

The hub also shows recently-written notes and a **needs filling in** list — the
records with no practice area, no court, no batch year, no relationships.

**Directory** (`/directory`) is the faceted list. The sidebar is collapsible;
practice area, court and city are open by default and everything else folds away.

**Screener** (`/screener`) is the same engine with everything turned on: ranges,
any/all matching, chamber lineage, degrees of separation, note search, thin
records.

**Profile** (`/lawyer/:slug`) — standing at the Bar, practice areas by emphasis,
courts by frequency, chamber history, education, positions, clerkships,
relationships grouped by category, matters, publications, contacts, provenance —
and the notes panel, right at the top where it is useful.

**Network** (`/network/:slug`) — force-directed relationship graph.

**My notes** (`/notes`) — every note in one feed, full-text searchable.

## Notes

Add one from any profile. Each note has a kind — Note, Impression, Heard that,
Met, To do, Source — an optional date, and can be pinned to the top. They are
searchable from the screener:

```
/screener?note_q=arbitration
/screener?has_notes=true&sort=notes_desc
```

## Relationships

Twenty-four typed, directional edge types with automatic inverse resolution.
Each edge records the chamber, institution, court or matter it arose in, the
years, and a confidence.

| Category | Types |
|---|---|
| Chamber | `chamber_junior_of` ↔ `mentor_of` · `former_chamber_junior_of` ↔ `former_mentor_of` · `co_junior_with` · `successor_in_chamber_of` ↔ `predecessor_in_chamber_of` |
| Family | `spouse_of` · `parent_of` ↔ `child_of` · `sibling_of` · `grandparent_of` ↔ `grandchild_of` · `uncle_aunt_of` ↔ `nephew_niece_of` · `cousin_of` · `in_law_of` · `relative_of` |
| Professional | `briefs` ↔ `briefed_by` (AoR ↔ counsel) · `leads` ↔ `led_by` · `co_counsel_with` · `opposed` |
| Firm | `partner_of` · `colleague_of` · `founded_with` |
| Education | `taught_by` ↔ `taught` · `classmate_of` · `alumnus_peer_of` · `moot_partner_of` |
| Court | `law_clerk_to` ↔ `had_law_clerk` |

Family labels are gender-neutral by design — the schema does not know anyone's
gender and should not infer it from a name. Put the exact relation ("her
grandson", "his brother-in-law") in the edge's `note`.

Chamber lineage traverses transitively: `/directory?chamber_lineage_of=<slug>`
returns the juniors, and the juniors' juniors.

## Useful queries

| Ask | Query |
|---|---|
| Everyone from the class of 2001 | `/directory?batch_year=2001` |
| NLS alumni in Delhi | `/directory?institutions=nls-bengaluru&city=New+Delhi` |
| Who came out of a chamber | `/directory?chamber_lineage_of=<slug>` |
| Anyone with a family tie recorded | `/directory?relationship_categories=family` |
| Who I have notes on, most-noted first | `/screener?has_notes=true&sort=notes_desc` |
| Records I still need to fill in | `/directory?missing=practice_areas` |
| Within two degrees of someone | `/directory?connected_to=<slug>&connection_depth=2` |

## JSON

Every page has a JSON twin — add `format=json`, or:

```
GET /api/screen?practice_areas=arbitration&batch_from=2000&courts=bombay-hc
GET /api/browse/:dimension
GET /api/lawyer/:slug
GET /api/network/:slug?depth=2
GET /api/taxonomy
```

Notes are never included in API output.

## Sharing it — static export

```bash
npm run export
```

Produces **`dist/index.html`: one self-contained file**, ~1.9 MB, no dependencies
and no network requests. Browse, facets, search, profiles and the relationship
graph all run client-side. Open it with `file://`, email it, or drop it on any
static host.

| Flag | Effect |
|---|---|
| `--out=share.html` | write somewhere else |
| `--title="…"` | page title and heading |
| `--verified-only` | drop records with no cited source — the safest thing to share |
| `--include-notes` | **ships your private notes in plain text**. Off by default; the script warns loudly when you use it. |

Private notes are excluded by default and the exporter proves it — the embedded
payload contains zero note records unless you ask for them.

Two useful variants:

```bash
npm run export -- --verified-only --out=dist/verified-only.html --title="Supreme Court Advocates"
npm run export                       # everything, notes still excluded
```

### Hosting

Any of these work, since it is a single static file:

```bash
# preview locally
cd dist && python3 -m http.server 8080     # then http://localhost:8080

# Netlify — drag dist/ onto app.netlify.com/drop, or:
npx netlify-cli deploy --dir=dist --prod

# Cloudflare Pages
npx wrangler pages deploy dist

# GitHub Pages: commit dist/index.html to a repo, enable Pages on that folder
```

Or just send the file. It works opened straight from disk.

**Before you share:** the page names real, identifiable people. Prefer
`--verified-only` so everything in it has a citation behind it, and never pass
`--include-notes` to a file that leaves your machine.

## Layout

```
db/01-schema.sql        31 tables. Jurisdiction-neutral structure.
db/02-taxonomy.sql      Courts, practice areas, law schools, Bar Councils,
                        relationship vocabulary. The India-specific layer —
                        swap this file to port the model elsewhere.
data/nls-alumni.json    Generated from the RTF by the converter.
data/firm-partners.json 433 law firm partners, 37 firms and 146 reported
                        transactions, generated from the deal-coverage database.
data/sc-advocates.json  25 Supreme Court advocates, researched from public
data/sc-advocates-batch2.json
                        sources; every record cites at least one URL. Batch 2
                        adds 30 more, including the chamber and family ties
                        that link them to batch 1.
scripts/build-db.js         Rebuild from scratch.
scripts/import-json.js      Idempotent bulk import, upserting on slug.
scripts/convert-nls-rtf.js  RTF alumni list -> import JSON, with a review log.
scripts/convert-firm-db.js  Deal-coverage SQLite -> import JSON (partner level).
scripts/export-static.js    One-file static export for sharing.
src/screen.js           The screener engine + browse dimensions.
src/profile.js          Profile assembly + graph traversal.
src/server.js           Routes. HTML and JSON from the same handlers.
src/views/              Server-rendered HTML. No template engine, no build step.
src/static-app.js       Client-side app embedded in the static export.
public/                 Stylesheet and the canvas force layout.
docs/DATA-DICTIONARY.md Import record shape, field by field.
```

## Design decisions worth knowing

**Everything screenable is normalised.** No filterable attribute lives in a JSON
blob. That is what lets facet counts, any/all modes, and graph filters all
compose in one query builder.

**Provenance is not a later feature.** `source` and `source_link` exist from day
one, the importer attaches a source to every record it writes, and
`verification_status` moves through `unverified → source_backed → self_claimed →
bar_verified`. The NLS import lands at `unverified` on purpose.

**No plain-language intake.** Phase 4 lets litigants navigate the taxonomy
directly with definitions attached, rather than describing their problem in
their own words and having software decide what kind of case it is. Reasoning in
[ROADMAP.md](ROADMAP.md).

**No rankings.** The screener returns reasoned matches, never scores.

## Jurisdiction

Modelled for India — Advocates, Senior Advocates, Advocates-on-Record, State Bar
Council enrolment, chamber juniors, High Court benches, tribunals. The schema is
jurisdiction-neutral; the vocabulary lives entirely in `db/02-taxonomy.sql`.
