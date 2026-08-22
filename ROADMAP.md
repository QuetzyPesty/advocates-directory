# Advocates Directory & Screener — Phased Plan

A structured, queryable record of the Bar: who practises what, where they appear,
and how they are connected to each other. Built so that one data model serves
three audiences without three separate products.

**Phase 1 is private.** It runs on `127.0.0.1` as a single-user working record —
a diary of the Bar as much as a directory. Notes are unreserved because nobody
else can read them. Opening it up is Phase 3's job, and the schema already keeps
the private layer separable.

**Jurisdiction assumption:** India. The vocabulary (Advocate, Senior Advocate,
Advocate-on-Record, chamber junior, State Bar Council enrolment, High Court
benches, tribunals) is baked into the taxonomy but not into the schema — the
structure ports to other jurisdictions by swapping `db/02-taxonomy.sql`.

---

## The three audiences and what each one needs

| Audience | Core question | What the data must support |
|---|---|---|
| **Students** | "Where do I intern, and who takes juniors?" | Intake signals, chamber size, practice mix, city, stipend, application route, alumni ties to their college |
| **Lawyers** | "Who does this work, and who do I know who knows them?" | Practice-area depth, court presence, chamber lineage, co-counsel history, referral paths |
| **Litigants** | "Who is right for *my* case?" | Defined practice areas and forums they can navigate themselves, engagement route (direct vs. through an AoR/instructing counsel), fee bands, legal aid |

All three are **screens over the same graph**. That is the design bet: build the
graph once, expose three lenses.

---

## Phase 1 — The Directory *(built — this repo)*

**Goal:** a trustworthy, queryable record of advocates with rich profiles and a
mapped relationship graph.

Delivered:

- **Full relational schema** (`db/01-schema.sql`) — 30 tables covering people,
  organisations, courts, practice areas, institutions, education, affiliations,
  positions, clerkships, matters, publications, awards, contacts, languages,
  bar enrolment, and a typed relationship edge table.
- **Relationship graph** with 20 typed, directional edge types and automatic
  inverse resolution: `chamber_junior_of`, `former_chamber_junior_of`,
  `co_junior_with`, `partner_of`, `co_counsel_with`, `briefs`/`briefed_by`
  (AoR ↔ arguing counsel), `led_by`/`leads`, `law_clerk_to`, `taught_by`,
  `classmate_of`, `successor_in_chamber_of`, and a full family vocabulary —
  `spouse_of`, `parent_of`/`child_of`, `sibling_of`,
  `grandparent_of`/`grandchild_of`, `uncle_aunt_of`/`nephew_niece_of`,
  `cousin_of`, `in_law_of`, and generic `relative_of`. Edges carry the
  chamber/institution/court they arose in, plus years and confidence.
- **Provenance from day one** — every fact can carry a `source` row
  (self-declared, court record, Bar Council roll, firm site, news) with a
  retrieval date, plus a `change_log` for edits.
- **A real screener engine** (`src/screen.js`) — composable facet filters with
  any/all semantics, experience and batch ranges, geography, language,
  institution, chamber-lineage traversal, degrees of separation, note search,
  and "show me the thin records". This is the piece Phases 2–4 reuse rather than
  reimplement.
- **Ten browse dimensions** (`/browse/:dimension`) — practice area, court, city,
  law school, batch, chamber, standing, language, Bar Council, relationship.
  Each one lists every value in use with a count, and opens straight into the
  filtered directory. This is the reading-down-a-list way in; the screener is
  the filtering way in.
- **A private notes layer** (`person_note`) — impressions, second-hand accounts,
  records of meetings, follow-ups. Pinnable, typed, full-text searchable, and
  filterable from the screener (`has_notes`, `note_q`). Private by default and
  excluded from the JSON API by construction, not by convention.
- **Web app** — browse hub, faceted directory, advanced screener, full profile
  pages with inline note-taking, interactive network view, and a JSON API
  mirroring every screen except the notes.
- **Ingest path** — `scripts/import-json.js` for bulk loading with an idempotent
  upsert on `slug`, and `scripts/convert-nls-rtf.js` for turning a hand-written
  RTF list into import JSON with a review log of everything it had to infer.

**Deliberately deferred:** authentication, profile claiming, public editing,
scraped data. Phase 1 runs as a **private, single-user working copy** — the
server binds to `127.0.0.1` only, and notes are unreserved because nobody else
can read them. Everything that would make it multi-user starts in Phase 3.

---

## Phase 2 — The Internship Directory *(schema stubs already in place)*

**Goal:** students find, evaluate, and apply to chambers and firms.

Build:

1. **Activate `internship_offer`** — host (person *or* organisation), forum,
   city, duration, intake months, seats, stipend band, eligibility year,
   application route and deadline. Table exists; needs UI + admin entry.
2. **`student_profile` + `internship_application`** — year of study, college,
   interest areas, preferred city, CV link; application status pipeline.
3. **A student lens on the screener** — reuse `src/screen.js`, add facets:
   `accepts_interns`, `intern_intake_note`, chamber size band, "alumni of my
   college", "juniors from my college currently in this chamber".
4. **The lineage advantage** — surface *"3 people from your college have
   juniored in this chamber"* directly from the Phase 1 graph. This is the
   feature that only exists because the relationships were modelled first.
5. **Seasonal calendar** — intake months are already a column; render an
   application timeline.

New surface: `/internships`, `/internships/:id`, `/students/me`.

---

## Phase 3 — The Lawyers' Directory

**Goal:** practitioners map the Bar, find counsel to brief, and find referral
paths.

Build:

1. **Expertise depth, not just presence** — weight `person_practice_area` by
   reported matters, years, and forum. Move from "does X" to "how much X".
2. **Matter graph** — populate `matter` + `person_matter` from reported
   judgments. Co-counsel and led-by edges then become *derivable* rather than
   hand-entered.
3. **Path finding** — "how do I reach Senior Advocate X?" as a shortest-path
   query over `relationship`. The graph traversal in `src/network.js`
   generalises to this with a BFS and an edge-weight table.
4. **Briefing chains** — for the Supreme Court, model the AoR requirement
   explicitly: which AoRs regularly brief which Seniors, in which subjects.
5. **Claim-your-profile** — auth, verification against Bar Council enrolment,
   self-service editing writing through `change_log`.
6. **Peer signal** — endorsements between verified practitioners, scoped to
   practice area. Kept peer-only and attributable; no anonymous ratings.

New surface: `/network`, `/paths`, `/claim`, authenticated edit views.

---

## Phase 4 — The Litigant's Directory

**Goal:** someone outside the profession can find the right counsel — through a
structured route, not a guessing game about what their problem is called.

**Deliberately not doing:** a plain-language intake that reads "my landlord won't
return my deposit" and decides what kind of case it is. That is a classification
engine giving legal advice with no lawyer in the loop; it will be confidently
wrong on facts it cannot see, and being wrong about the forum or a limitation
period is the expensive kind of wrong. The `matter_type` table that held those
mappings has been dropped from the schema.

Instead, the route is structured and slightly harder — and honest about it:

1. **Navigate the taxonomy, don't guess at it.** The litigant picks along the
   axes the directory already has: forum → practice area → city → engagement
   route. Each step is a real, defined value with a definition attached, not an
   inferred one. The browse dimensions built in Phase 1 are exactly this
   navigation; Phase 4 adds a litigant-facing renderer over them.
2. **Definitions, not diagnoses.** Every practice area and forum carries a
   `description`. Show it. "Writ Petitions — challenges to action by a public
   authority, in the High Court under Article 226" tells a litigant what the
   category *is* and lets them decide whether it fits. It does not tell them
   their case belongs there.
3. **Engagement route, made explicit.** `accepts_direct_briefs` already exists,
   as does `court.requires_aor`. A litigant needs to know that a Senior Advocate
   is instructed through an Advocate-on-Record, that the Supreme Court requires
   an AoR to file, and roughly what that chain costs.
4. **Fee bands and legal aid.** Voluntary, self-declared, banded — never scraped,
   never precise. `fee_band`, `legal_aid_panel` and `takes_pro_bono` are already
   columns.
5. **Reference explainers, kept separate from any specific matter.** What a
   Senior Advocate is, what an AoR does, what a vakalatnama is, what to bring to
   a first meeting. Written once, linked from the navigation, not generated in
   response to a description of someone's problem.
6. **Shortlist with reasons, never a ranking.** Output 5–8 candidates each with
   the reason they appear ("appears regularly in the Delhi High Court in service
   matters, 14 years, takes instructions directly, speaks Hindi"). A scored
   league table of lawyers invites both liability and gaming.

New surface: `/find` (structured navigation over the existing dimensions),
`/guides/*`, and a client-facing lens on the profile page.

## Phase 5 — Data quality, scale, and trust

Ongoing, but becomes the main job once the graph is large.

- **Verification tiers** — `verification_status` is on `person` from Phase 1:
  `unverified → source_backed → self_claimed → bar_verified`. Show the tier in
  the UI; let facets filter on it.
- **Ingest pipelines** — Bar Council rolls, cause lists, reported judgments,
  firm sites. Every pipeline writes `source` rows; nothing enters unattributed.
- **Deduplication** — same advocate, multiple spellings and enrolment records.
- **Correction workflow** — a public "this is wrong" route into `change_log`.
- **Privacy and consent** — see below.

---

## Cross-cutting constraints (decided now, not later)

**Personal data.** This is a record of real, identifiable people, largely built
from public professional records. In Phase 1 it is private and single-user, which
is why the notes layer can hold unreserved observations. The moment any of it is
opened up — Phase 3 onwards — three things must happen first: notes stay behind
the owner's login (they already live in their own table for exactly this reason),
contact details stay behind `person_contact.is_public`, and people can claim and
correct their own entries. Under the DPDP Act 2023 the publishable posture is
professional facts only, with a working takedown route. The schema supports all
of it today: `visibility` on `person`, `is_public` on contacts, `is_private` on
notes, and `change_log` for audit.

**No fabricated facts.** Everything in the sample dataset is clearly synthetic
and marked as such. Real records should only ever arrive through an importer
that attaches a `source`.

**No public rankings.** Peer endorsements are scoped and attributable; litigant
output is a reasoned shortlist. The moment this becomes a leaderboard it becomes
both a liability and a target for manipulation.

**The screener stays generic.** `src/screen.js` takes a filter object and
returns rows. Every audience lens is a preset filter set plus a different
renderer — never a fork of the query engine.
