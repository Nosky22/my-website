# FPL Badger — Analysis (Phase 1)

Offline modelling over the `fpl` schema. Reads via `ingest/query.py` (paginated,
never a bare row-select); writes idempotent upserts to derived tables. Mirrors
`ingest/` conventions. All studies are walk-forward — a model at gameweek *t*
sees only data with GW ≤ *t*.

## Study 1 — Form & ELO  ✅ (foundation)

`python -m analysis.run_study1`   ·   `python -m analysis.run_study1 --verify`

Writes `team_elo`, `team_form`, `player_form`, and a provenance row in
`insights` (`study1-form-elo-provenance`).

| Module | Role |
|---|---|
| `params.py` | ELO & form parameters (documented, tunable) |
| `burnin.py` | 2018-19 + 2019-20 burn-in matches (vaastav; team `code`-linked) |
| `elo.py` | Team ELO: burn-in warm → record 2020/21-2025/26 |
| `xpts.py` | Match xPts (independent Poisson from player-aggregated xG) |
| `team_form.py` | Rolling last-6/10 team form (+ xPts, pts_vs_xpts) |
| `player_form.py` | Rolling last-4/6 player form (mins, pts, xGI/90 vs baseline) |
| `verify_study1.py` | Counts, no-lookahead invariant, burn-in stability, ClubELO |

**Key design decisions (see `params.py` + the provenance row):**
- Cross-season team identity via persistent `code` (added to `fpl.teams`).
- ELO: start 1500, K=20 + 538 MOV multiplier, ⅓ boundary regression, promoted
  1350. Burn-in over 2018/19+2019/20 (760 matches); ratings stabilise
  (rank-corr ≥0.90 vs final) after ~1 season, well before recording.
- **HFA is regime-based by match date.** `normal` = 49.7 Elo [CI 26.6, 73.4],
  **fit** from pre-2020/21 data (walk-forward clean). `behind_closed_doors` = 0,
  a **DOMAIN PRIOR** (empty stadiums, not a fit — the empirical bcd fit N=92 was
  useless [CI -7.6, 121.8]). 2020/21 flagged `crowd_conditions=
  'behind_closed_doors'`; the 49.7->0 choice is negligible in effect (2020/21
  mean |dElo| ~2, max ~5, identical final rank order). 2020/21 also structurally
  odd (no crowds, compressed schedule, 5 subs) - downstream home/away-sensitive
  studies should consider excluding it. Tunable.
- xPts: independent Poisson **under-predicts draws** (Dixon–Coles deficiency) —
  relative `pts_vs_xpts` valid, absolute `xPts` biased. Full_xg seasons only;
  null for 2020/21–2021/22.

**Verification (last run):** team_elo 4,540 · team_form 9,072 · player_form
312,150. No-lookahead: **0 idle-team violations** (1 benign sub-precision draw).
Final 2023/24 ELO reproduces the real top 3 (MCI/ARS/LIV) and the three relegated
teams at the bottom; 2020/21 home-field anomaly reproduced from scratch. **ClubELO
Spearman rho = 0.95-0.99** across three dates (independent rank validation;
ClubELO never enters the model). Re-run all checks: `python -m analysis.verify_study1`
