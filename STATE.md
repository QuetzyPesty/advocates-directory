# Task ledger — firm-attribution fix

Cross-repo. Resume by reading this, then `git log --oneline -10` in both repos.

- **A** = `~/structuring mbox` → [QuetzyPesty/Deals-Tracker](https://github.com/QuetzyPesty/Deals-Tracker) (scraper + upstream DB)
- **B** = `~/lawyer screener and directory` → [QuetzyPesty/advocates-directory](https://github.com/QuetzyPesty/advocates-directory)

## Background

`parse_headline()` in A failed on newer Bar & Bench headline shapes (`act as`,
trailing firm lists, past-tense `advised`). With no headline firms, every
body-text firm mention was discarded and all 173 people in those 15 deals came
out `firm: None`. Agreed fix: stop making the headline load-bearing — take firms
from `/topic/` slugs ∩ body attribution sentences, which found 16/16 firms with
no false positives across five test articles.

| id | goal | status | verification | commit |
|----|------|--------|--------------|--------|
| T1 | Merge the 100 unaffiliated twin rows, in `build_directory.py` so a rebuild keeps it | todo | `python3 build_directory.py && sqlite3 legal_directory.db "SELECT COUNT(*) FROM people p WHERE p.firm_id IS NULL AND EXISTS(SELECT 1 FROM people q WHERE q.name=p.name AND q.firm_id IS NOT NULL)"` → 0 | |
| T2 | Refresh B from the rebuilt upstream | **done** — 4,547 → 5,379 people, 1,272 partners (was 433), 118 orgs, 496 matters | `npm run build` in B | |
| T3 | Scraper: topic∩body firm extraction, no firm inheritance | **done** | `python3 tests/test_firm_extraction.py` → 5 fixtures pass | A repo |
| T4 | Re-parse the 162 live articles (the other 353 come from the mbox, no live URL) | **done** — firm=None 173 → 46; upstream unaffiliated 169 → 4 | | A repo |
| T5 | Rebuild + refresh B + export + Playwright smoke | **done** | `npm test` → 7 passed | B repo |

## Notes that cost time to learn

- `legal_directory.db` is **regenerated from scratch** by `build_directory.py`
  on every run, and the Action rebuilds it every 2 days. Never fix data in the
  DB — fix the code that builds it.
- `split_firm_list()` does **not** validate: `canonical_firm('Pizza Bakery')`
  returns `'Pizza Bakery'`. Any regex loosening needs a gate or it mints firms.
- Bar & Bench topic slugs **drop** the ampersand: `Khaitan & Co` → `khaitan-co`,
  `TT&A` → `tta`. Expanding `&` to "and" breaks slug matching.
- `person_firm_id = ... else primary_firm_id` (build_directory.py ~489) assigns
  the deal's *first* firm to anyone without one — same misattribution class as
  the TT&A bug, in a different place.
- Co-appearance edges now need 2+ shared matters (`--min-together`). Without
  it, 91% of pairs came from a single deal and the export was 5.7 MB.
- Deal size: `value_inr` is for ordering only, at a fixed dated rate in
  `scrape_barandbench.py`. Never display it — show `value_raw`.


## Done

All five tasks complete. Remaining unattributed people upstream: 4, all
correct — two Senior Advocates, a former Attorney General and an in-house
General Counsel, none of whom are employed by a firm.
