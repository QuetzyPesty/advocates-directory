-- ============================================================================
-- Advocates Directory & Screener — core schema
-- SQLite. Loaded by scripts/build-db.js.
--
-- Design notes:
--  * Every screenable attribute is normalised into its own table so the
--    screener can facet on it. Nothing screenable lives in a JSON blob.
--  * Every fact can carry provenance via `source` / `source_link`.
--  * Phase 2/3/4 tables are created here but left empty — see ROADMAP.md.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Reference taxonomies
-- ---------------------------------------------------------------------------

-- Hierarchical: "Commercial" > "Arbitration" > "Investment Treaty Arbitration"
CREATE TABLE practice_area (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  parent_id     INTEGER REFERENCES practice_area(id),
  description   TEXT,
  sort_order    INTEGER DEFAULT 100
);

-- Courts, tribunals, commissions, regulators, arbitral institutions.
-- Benches hang off their parent High Court via parent_id.
CREATE TABLE court (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  short_name    TEXT,
  court_type    TEXT NOT NULL CHECK (court_type IN (
                  'supreme','high_court','high_court_bench','district','sessions',
                  'tribunal','commission','regulator','arbitral','consumer',
                  'family','labour','revenue','foreign','other')),
  parent_id     INTEGER REFERENCES court(id),
  city          TEXT,
  state         TEXT,
  -- does appearing here require Advocate-on-Record status or similar?
  requires_aor  INTEGER NOT NULL DEFAULT 0,
  jurisdiction_note TEXT,
  sort_order    INTEGER DEFAULT 100
);

CREATE TABLE institution (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  short_name    TEXT,
  type          TEXT CHECK (type IN ('law_school','university','college','other')),
  city          TEXT,
  state         TEXT,
  country       TEXT DEFAULT 'India'
);

-- Chambers, law firms, in-house teams, government law offices.
CREATE TABLE organisation (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN (
                  'chamber','law_firm','in_house','government','psu',
                  'ngo','legal_aid','tribunal_panel','academic','other')),
  -- for chambers: the advocate whose chamber it is
  head_person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
  city          TEXT,
  state         TEXT,
  website       TEXT,
  founded_year  INTEGER,
  size_band     TEXT CHECK (size_band IN ('solo','2-5','6-15','16-50','51-200','200+')),
  description   TEXT
);

CREATE TABLE bar_council (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  state         TEXT,
  code          TEXT              -- enrolment prefix, e.g. 'D' for Delhi
);

CREATE TABLE language (
  code          TEXT PRIMARY KEY, -- ISO 639-1 where available
  name          TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

CREATE TABLE source (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'self_declared','bar_council_roll','court_record','judgment',
                  'cause_list','firm_website','professional_profile','news',
                  'directory','manual_entry','synthetic')),
  title         TEXT,
  url           TEXT,
  retrieved_at  TEXT,
  note          TEXT
);

-- Generic: attach a source to any row, optionally to a specific field.
CREATE TABLE source_link (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  field         TEXT
);
CREATE INDEX idx_source_link_entity ON source_link(entity_type, entity_id);

CREATE TABLE change_log (
  id            INTEGER PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  field         TEXT,
  old_value     TEXT,
  new_value     TEXT,
  actor         TEXT,             -- 'import:bci-2026-01', 'user:42', 'admin'
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_change_log_entity ON change_log(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- People — the centre of the model
-- ---------------------------------------------------------------------------

CREATE TABLE person (
  id                  INTEGER PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  full_name           TEXT NOT NULL,
  preferred_name      TEXT,
  honorific           TEXT,        -- 'Mr','Ms','Dr','Justice','Sr. Adv.'
  -- Only ever populated from a self-declaration. Never inferred from a name.
  pronouns            TEXT,

  -- Standing at the Bar ---------------------------------------------------
  designation         TEXT NOT NULL DEFAULT 'advocate' CHECK (designation IN (
                        'advocate','senior_advocate','advocate_on_record',
                        'senior_advocate_aor','solicitor','judge','retired_judge',
                        'academic','in_house_counsel','other')),
  is_senior_advocate  INTEGER NOT NULL DEFAULT 0,
  senior_designated_year   INTEGER,
  senior_designating_court_id INTEGER REFERENCES court(id),
  is_aor              INTEGER NOT NULL DEFAULT 0,   -- Supreme Court Advocate-on-Record
  aor_year            INTEGER,
  aor_code            TEXT,

  bar_council_id      INTEGER REFERENCES bar_council(id),
  enrolment_number    TEXT,
  enrolment_year      INTEGER,
  first_year_of_practice INTEGER,        -- drives years_experience
  class_of            INTEGER,           -- graduating batch, for browse-by-batch

  status              TEXT NOT NULL DEFAULT 'practising' CHECK (status IN (
                        'practising','on_bench','retired','inactive','deceased')),

  -- Where they work -------------------------------------------------------
  primary_court_id    INTEGER REFERENCES court(id),
  primary_organisation_id INTEGER REFERENCES organisation(id),
  base_city           TEXT,
  base_state          TEXT,
  country             TEXT DEFAULT 'India',

  -- Narrative -------------------------------------------------------------
  headline            TEXT,        -- one line, e.g. 'Constitutional & service law, Delhi HC'
  short_bio           TEXT,
  long_bio            TEXT,
  photo_url           TEXT,

  -- Engagement signals (Phase 2 / Phase 4 read these) ----------------------
  accepts_interns     INTEGER NOT NULL DEFAULT 0,
  intern_intake_note  TEXT,
  accepts_direct_briefs INTEGER,   -- 0 for Senior Advocates: must be briefed
  takes_pro_bono      INTEGER NOT NULL DEFAULT 0,
  legal_aid_panel     INTEGER NOT NULL DEFAULT 0,
  fee_band            TEXT CHECK (fee_band IN ('unknown','legal_aid','modest','mid','premium','senior_counsel')),
  available_for_mentoring INTEGER NOT NULL DEFAULT 0,

  -- Trust -----------------------------------------------------------------
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
                        'unverified','source_backed','self_claimed','bar_verified')),
  verified_at         TEXT,
  visibility          TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','limited','hidden')),

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_person_designation ON person(designation);
CREATE INDEX idx_person_city ON person(base_city);
CREATE INDEX idx_person_court ON person(primary_court_id);
CREATE INDEX idx_person_experience ON person(first_year_of_practice);
CREATE INDEX idx_person_interns ON person(accepts_interns);
CREATE INDEX idx_person_class ON person(class_of);

-- ---------------------------------------------------------------------------
-- Person attributes (each one is a screener facet)
-- ---------------------------------------------------------------------------

CREATE TABLE person_practice_area (
  person_id        INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  practice_area_id INTEGER NOT NULL REFERENCES practice_area(id) ON DELETE CASCADE,
  emphasis         TEXT NOT NULL DEFAULT 'secondary'
                     CHECK (emphasis IN ('primary','secondary','occasional')),
  years_active     INTEGER,
  evidence_note    TEXT,
  PRIMARY KEY (person_id, practice_area_id)
);
CREATE INDEX idx_ppa_area ON person_practice_area(practice_area_id, emphasis);

CREATE TABLE person_court (
  person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  court_id   INTEGER NOT NULL REFERENCES court(id) ON DELETE CASCADE,
  frequency  TEXT NOT NULL DEFAULT 'regular'
               CHECK (frequency IN ('primary','regular','occasional')),
  since_year INTEGER,
  note       TEXT,
  PRIMARY KEY (person_id, court_id)
);
CREATE INDEX idx_pc_court ON person_court(court_id, frequency);

CREATE TABLE person_language (
  person_id     INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES language(code),
  proficiency   TEXT CHECK (proficiency IN ('native','fluent','working','reading')),
  PRIMARY KEY (person_id, language_code)
);
CREATE INDEX idx_pl_lang ON person_language(language_code);

CREATE TABLE person_education (
  id             INTEGER PRIMARY KEY,
  person_id      INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  institution_id INTEGER NOT NULL REFERENCES institution(id),
  degree         TEXT,             -- 'B.A. LL.B. (Hons.)', 'LL.M.', 'B.C.L.'
  field          TEXT,
  start_year     INTEGER,
  end_year       INTEGER,
  distinction    TEXT
);
CREATE INDEX idx_pe_person ON person_education(person_id);
CREATE INDEX idx_pe_institution ON person_education(institution_id);

-- Chamber / firm history. Also what makes chamber lineage queryable.
CREATE TABLE person_affiliation (
  id              INTEGER PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  organisation_id INTEGER NOT NULL REFERENCES organisation(id),
  role            TEXT NOT NULL CHECK (role IN (
                    'intern','law_clerk','chamber_junior','junior_counsel',
                    'associate','senior_associate','principal_associate',
                    'counsel','of_counsel','partner','equity_partner',
                    'founder','founding_partner','managing_partner','head_of_chambers',
                    'standing_counsel','panel_counsel','in_house','other')),
  start_year      INTEGER,
  end_year        INTEGER,
  is_current      INTEGER NOT NULL DEFAULT 0,
  note            TEXT
);
CREATE INDEX idx_pa_person ON person_affiliation(person_id);
CREATE INDEX idx_pa_org ON person_affiliation(organisation_id, role);

-- Offices held: ASG, Standing Counsel, Amicus, Bar Association posts, AMICUS etc.
CREATE TABLE person_position (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,                -- appointing body / association
  court_id   INTEGER REFERENCES court(id),
  start_year INTEGER,
  end_year   INTEGER,
  note       TEXT
);
CREATE INDEX idx_ppos_person ON person_position(person_id);

CREATE TABLE person_clerkship (
  id              INTEGER PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  judge_person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
  judge_name      TEXT,           -- when the judge is not a row in `person`
  court_id        INTEGER REFERENCES court(id),
  start_year      INTEGER,
  end_year        INTEGER
);
CREATE INDEX idx_pck_person ON person_clerkship(person_id);

CREATE TABLE person_credential (
  id        INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind      TEXT CHECK (kind IN ('qualification','accreditation','panel','bar_admission','other')),
  name      TEXT NOT NULL,        -- 'FCIArb', 'MCPC-accredited mediator', 'NY Bar'
  issuer    TEXT,
  year      INTEGER
);

CREATE TABLE person_publication (
  id        INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  venue     TEXT,
  year      INTEGER,
  url       TEXT
);

CREATE TABLE person_award (
  id          INTEGER PRIMARY KEY,
  person_id   INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  awarded_by  TEXT,
  year        INTEGER
);

CREATE TABLE person_contact (
  id        INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN (
              'chambers_address','office_address','email','phone',
              'clerk_name','clerk_phone','website','profile_url','other')),
  label     TEXT,
  value     TEXT NOT NULL,
  -- Contact details default to private. Phase 4 exposes only what is opted in.
  is_public INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pcon_person ON person_contact(person_id);

-- ---------------------------------------------------------------------------
-- Private notes — the diary layer
--
-- Phase 1 runs as a personal record, so notes are unreserved: impressions,
-- second-hand accounts, reminders. They are PRIVATE BY DEFAULT and are never
-- included in any export or public view. If this directory is ever opened up
-- (Phase 3 onwards), notes stay behind the owner's login — that is the whole
-- reason they live in their own table rather than as a column on `person`.
-- ---------------------------------------------------------------------------

CREATE TABLE person_note (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN (
               'note',        -- general observation
               'impression',  -- what they are like to deal with
               'hearsay',     -- second-hand; treat accordingly
               'met',         -- a record of an actual encounter
               'todo',        -- follow up
               'source')),    -- where a fact on this profile came from
  body       TEXT NOT NULL,
  occurred_on TEXT,           -- when the thing happened, if that matters
  is_private INTEGER NOT NULL DEFAULT 1,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pnote_person ON person_note(person_id, pinned DESC, created_at DESC);

CREATE VIRTUAL TABLE person_note_fts USING fts5(
  body, content='person_note', content_rowid='id', tokenize='unicode61');
CREATE TRIGGER pnote_fts_ai AFTER INSERT ON person_note BEGIN
  INSERT INTO person_note_fts(rowid, body) VALUES (new.id, new.body);
END;
CREATE TRIGGER pnote_fts_ad AFTER DELETE ON person_note BEGIN
  INSERT INTO person_note_fts(person_note_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;
CREATE TRIGGER pnote_fts_au AFTER UPDATE ON person_note BEGIN
  INSERT INTO person_note_fts(person_note_fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO person_note_fts(rowid, body) VALUES (new.id, new.body);
END;

-- ---------------------------------------------------------------------------
-- Matters (light in Phase 1; the backbone of Phase 3)
-- ---------------------------------------------------------------------------

CREATE TABLE matter (
  id               INTEGER PRIMARY KEY,
  title            TEXT NOT NULL,
  citation         TEXT,
  court_id         INTEGER REFERENCES court(id),
  year             INTEGER,
  practice_area_id INTEGER REFERENCES practice_area(id),
  outcome          TEXT,
  summary          TEXT,
  url              TEXT
);

CREATE TABLE person_matter (
  person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  matter_id INTEGER NOT NULL REFERENCES matter(id) ON DELETE CASCADE,
  role      TEXT CHECK (role IN (
              'arguing_counsel','senior_counsel','aor','briefing_counsel',
              'junior_counsel','amicus','intervenor_counsel','other')),
  side      TEXT,
  PRIMARY KEY (person_id, matter_id, role)
);

-- ---------------------------------------------------------------------------
-- The relationship graph
-- ---------------------------------------------------------------------------

CREATE TABLE relationship_type (
  code         TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  inverse_code TEXT,              -- NULL when symmetric
  symmetric    INTEGER NOT NULL DEFAULT 0,
  category     TEXT NOT NULL CHECK (category IN (
                 'chamber','firm','education','court','family','professional')),
  description  TEXT
);

CREATE TABLE relationship (
  id              INTEGER PRIMARY KEY,
  from_person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  to_person_id    INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  type            TEXT NOT NULL REFERENCES relationship_type(code),
  -- context: where the relationship arose
  organisation_id INTEGER REFERENCES organisation(id),
  institution_id  INTEGER REFERENCES institution(id),
  court_id        INTEGER REFERENCES court(id),
  matter_id       INTEGER REFERENCES matter(id),
  start_year      INTEGER,
  end_year        INTEGER,
  strength        INTEGER DEFAULT 3 CHECK (strength BETWEEN 1 AND 5),
  verified        INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_person_id <> to_person_id)
);
CREATE INDEX idx_rel_from ON relationship(from_person_id, type);
CREATE INDEX idx_rel_to   ON relationship(to_person_id, type);
CREATE UNIQUE INDEX idx_rel_unique
  ON relationship(from_person_id, to_person_id, type, IFNULL(start_year,0));

-- ---------------------------------------------------------------------------
-- Phase 2 — internships (tables created now, populated in Phase 2)
-- ---------------------------------------------------------------------------

CREATE TABLE internship_offer (
  id               INTEGER PRIMARY KEY,
  person_id        INTEGER REFERENCES person(id) ON DELETE CASCADE,
  organisation_id  INTEGER REFERENCES organisation(id) ON DELETE CASCADE,
  title            TEXT,
  court_id         INTEGER REFERENCES court(id),
  practice_area_id INTEGER REFERENCES practice_area(id),
  city             TEXT,
  duration_weeks   INTEGER,
  intake_months    TEXT,           -- JSON array: ["may","june","december"]
  seats            INTEGER,
  stipend_band     TEXT CHECK (stipend_band IN ('unpaid','token','modest','standard','generous')),
  eligibility_year TEXT,           -- '3,4,5' year of study
  application_mode TEXT CHECK (application_mode IN ('email','portal','referral_only','walk_in','other')),
  application_url  TEXT,
  contact_email    TEXT,
  description      TEXT,
  is_open          INTEGER NOT NULL DEFAULT 1,
  posted_at        TEXT DEFAULT (datetime('now')),
  closes_at        TEXT,
  CHECK (person_id IS NOT NULL OR organisation_id IS NOT NULL)
);

CREATE TABLE student_profile (
  id             INTEGER PRIMARY KEY,
  full_name      TEXT NOT NULL,
  email          TEXT,
  institution_id INTEGER REFERENCES institution(id),
  year_of_study  INTEGER,
  graduation_year INTEGER,
  city_preference TEXT,
  cv_url         TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE student_interest (
  student_id       INTEGER NOT NULL REFERENCES student_profile(id) ON DELETE CASCADE,
  practice_area_id INTEGER NOT NULL REFERENCES practice_area(id),
  PRIMARY KEY (student_id, practice_area_id)
);

CREATE TABLE internship_application (
  id         INTEGER PRIMARY KEY,
  offer_id   INTEGER NOT NULL REFERENCES internship_offer(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES student_profile(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
               'draft','submitted','shortlisted','offered','accepted','declined','rejected','withdrawn')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Saved screens — used by every audience lens
-- ---------------------------------------------------------------------------

CREATE TABLE saved_screen (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  audience    TEXT NOT NULL CHECK (audience IN ('student','lawyer','litigant','admin')),
  description TEXT,
  filters     TEXT NOT NULL,     -- JSON, consumed directly by src/screen.js
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Derived views
-- ---------------------------------------------------------------------------

CREATE VIEW v_person AS
SELECT
  p.*,
  CASE WHEN p.first_year_of_practice IS NOT NULL
       THEN CAST(strftime('%Y','now') AS INTEGER) - p.first_year_of_practice
  END AS years_experience,
  COALESCE(p.class_of, (SELECT MIN(pe.end_year) FROM person_education pe
                        WHERE pe.person_id = p.id AND pe.end_year IS NOT NULL)) AS batch_year,
  (SELECT COUNT(*) FROM person_note pn WHERE pn.person_id = p.id) AS note_count,
  c.name  AS primary_court_name,
  c.slug  AS primary_court_slug,
  o.name  AS primary_organisation_name,
  o.slug  AS primary_organisation_slug,
  bc.name AS bar_council_name
FROM person p
LEFT JOIN court        c  ON c.id  = p.primary_court_id
LEFT JOIN organisation o  ON o.id  = p.primary_organisation_id
LEFT JOIN bar_council  bc ON bc.id = p.bar_council_id;

-- Full-text search over names and narrative.
CREATE VIRTUAL TABLE person_fts USING fts5(
  full_name, preferred_name, headline, short_bio, long_bio,
  content='person', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER person_fts_ai AFTER INSERT ON person BEGIN
  INSERT INTO person_fts(rowid, full_name, preferred_name, headline, short_bio, long_bio)
  VALUES (new.id, new.full_name, new.preferred_name, new.headline, new.short_bio, new.long_bio);
END;
CREATE TRIGGER person_fts_ad AFTER DELETE ON person BEGIN
  INSERT INTO person_fts(person_fts, rowid, full_name, preferred_name, headline, short_bio, long_bio)
  VALUES ('delete', old.id, old.full_name, old.preferred_name, old.headline, old.short_bio, old.long_bio);
END;
CREATE TRIGGER person_fts_au AFTER UPDATE ON person BEGIN
  INSERT INTO person_fts(person_fts, rowid, full_name, preferred_name, headline, short_bio, long_bio)
  VALUES ('delete', old.id, old.full_name, old.preferred_name, old.headline, old.short_bio, old.long_bio);
  INSERT INTO person_fts(rowid, full_name, preferred_name, headline, short_bio, long_bio)
  VALUES (new.id, new.full_name, new.preferred_name, new.headline, new.short_bio, new.long_bio);
END;
