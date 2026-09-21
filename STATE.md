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
| T3 | Scraper: topic∩body firm extraction, headline fallback, no firm inheritance | todo | fixture tests pass; 0 of 162 deals with empty `law_firms` where the article names a firm | |
| T4 | Re-parse all 515 deals | todo | `people with firm=None` drops from 173 toward ~0 | |
| T5 | Rebuild + refresh B again + export + Playwright smoke | todo | `npm test` in B exits 0 | |

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
- **Open question for the owner:** the refresh took relationships from 3,446 to
  10,967, and 91% of the firm-derived edges come from a *single* shared deal.
  The shareable export went 2 MB → 5.7 MB. `derive-cause-lists.js` already
  thresholds at 3+ shared matters for exactly this reason; `convert-firm-db.js`
  has no threshold. Raised in the report, not changed unilaterally.
