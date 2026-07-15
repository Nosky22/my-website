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
- **HFA is regime-based by match date**, fit only from pre-2020/21 data
  (walk-forward): `normal` = 49.7 Elo [CI 26.6, 73.4]. The `behind_closed_doors`
  regime fit (2019/20 post-restart, N=92) is statistically uninformative
  [CI −7.6, 121.8], so it **defaults to the normal value**; 2020/21 is flagged
  `crowd_conditions='behind_closed_doors'` and its ratings knowingly over-credit
  home form (the empty-stadium HFA collapse was unknowable ex-ante). Tunable.
- xPts: independent Poisson **under-predicts draws** (Dixon–Coles deficiency) —
  relative `pts_vs_xpts` valid, absolute `xPts` biased. Full_xg seasons only;
  null for 2020/21–2021/22.

**Verification (last run):** team_elo 4,540 · team_form 9,072 · player_form
312,150. No-lookahead invariant **0 violations**. Final 2023/24 ELO reproduces
the real top 3 (MCI/ARS/LIV) and the three relegated teams at the bottom. 2020/21
home-field anomaly (HFA −8.2) reproduced from scratch. ClubELO Spearman check is
coded but pending (endpoint unreachable in the build environment).
