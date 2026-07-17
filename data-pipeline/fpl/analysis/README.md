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

## Study 2 — Factor-correlation  ✅ (the analytical heart)

`python -m analysis.run_study2` → 11 `insights` rows (`study2-factor-*`).

`stats.py` (Spearman + Fisher-z CI, pure-Python) · `study2_factors.py` (the 11
factors) · `run_study2.py` (assemble join once, run, write, print).

**Design:** unit = player-fixture; factors #1-9,11 measured on **starters
(≥60 min)** to isolate return-given-playing; #10 (minutes) on all rows.
Stateful factors (ELO, form) use value **entering** the GW (as-of t-1),
walk-forward. Every cell reports Spearman ρ + N + 95% CI; N<100 flagged thin.

**Headline findings (Spearman ρ, starters):**
- **#10 Minutes is everything** — ρ 0.84–0.95. The availability gate that
  confounds all else (hence conditioning on starters).
- **#3 Relative ELO is the strongest genuine skill signal** — DEF +0.28,
  MID +0.22; robust with/without 2020/21. Sharper than FDR.
- **#5 Team form adds ~nothing beyond baseline (NULL RESULT):** raw ρ 0.07–0.13
  collapses to **partial ρ ~0** (0.008–0.017) controlling for ELO. Recent "form"
  is largely regression-to-mean — materially simplifies the planner.
- **#1 FDR** works and is stable across seasons — DEF −0.24 to −0.26 strongest;
  FWD weakest (~−0.12). Analysed per-season (scale changed).
- **#4 Opponent facet** (correct signs): DEF vs opp attack −0.17, MID vs opp
  defence −0.13 — modest.
- **#9 Positional team strength** supports the thesis: DEF vs own defence +0.17
  > attackers vs own attack; team quality helps defenders most.
- **#2 Home/away** small (Cohen's d 0.05–0.16); **grows without 2020/21**
  (FWD delta +0.47→+0.60 pts) — quantifies the COVID home-advantage collapse.
- **#8 Ownership** (2025/26 only): weak (ρ ~0.1) and predictive ≈ contemporaneous
  — so it's *not* mainly a lagging artifact, but it's a weak return predictor
  either way; Study 6 must combine it with stronger signals.
- **#6 Player form** weak (ρ ≤0.13), consistent with #5. **#7 Price** ρ 0.23
  (MID) but lagging (transfer-driven). **#11 Set-piece** takers +0.7–0.9 pts/start
  (d~0.24) but 2025/26-only and thin (DEF n=46, GKP n=0).

Full per-position tables + CIs live in the `insights` payloads.

## Study 1 verification (last run)

**team_elo 4,540 · team_form 9,072 · player_form 312,150.** No-lookahead:
**0 idle-team violations** (1 benign sub-precision draw).
Final 2023/24 ELO reproduces the real top 3 (MCI/ARS/LIV) and the three relegated
teams at the bottom; 2020/21 home-field anomaly reproduced from scratch. **ClubELO
Spearman rho = 0.95-0.99** across three dates (independent rank validation;
ClubELO never enters the model). Re-run all checks: `python -m analysis.verify_study1`
