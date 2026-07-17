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

## Study 3 — Noise ceiling + per-factor decay  ✅ (parameterises the planner)

`python -m analysis.run_study3` → 5 `insights` rows (`study3-*`).
`study3_decay.py` (ceiling + curves) · `run_study3.py` (orchestrate/print/write).

**Noise ceiling (do this first — it recalibrates Study 2):** single-GW starter
points are **90–99% noise** (ICC 0.01 GKP · 0.06 DEF · 0.10 MID · 0.04 FWD).
Player-identity ceiling ρ = 0.12–0.32. So Study 2's ρ~0.28 are **large** effects
near the achievable frontier, not weak ones. (ELO meets/exceeds the ceiling for
DEF/GKP because it adds fixture signal orthogonal to player identity — the ICC
ceiling is a player-identity *lower* bound.)

**Decay measured vs CUMULATIVE points over t+1..t+n (planning-relevant); single-GW
as the decay-RATE signature.** Verdict on "which factors survive to 8+ GWs":
- **ELO / team strength — NON-DECAYING (flat single-GW ρ, DEF 0.12→0.10 over 10
  GWs).** Weak per-week but never fades → the long-horizon anchor. Plan GW30 on
  this. The fixture cluster (#1 FDR / #2 home-away / #4 facet / #9 positional) is
  ONE curve — views of team strength, not independent evidence.
- **Player form (last-4) — strongest single-week signal, decays only MODESTLY**
  (MID 0.23→0.18, 79% retained at h8; FWD fades faster). NOT "useless beyond 4–8
  GW" as the community prior assumed.
- **Player form beyond own baseline (the deferred #6 control) — REAL, not null.**
  Controlling for season-to-date-excl-last-4 (walk-forward), partial ρ stays
  clearly positive (MID cumulative 0.13→0.24). Unlike **team** form (§5.5, →0),
  **player** form carries genuine information (role/penalty/position change).
- **Minutes persistence — the central plannable curve, slow decay.** A starter
  today is still starting in 10 GWs with P = 0.73 (GKP) / 0.59 (DEF) / 0.57
  (MID) / 0.53 (FWD). Gradual, so half-season-plannable; GKP most nailed.
- Ownership/price rise cumulatively but are lagging quality-proxies (denominator,
  not predictor). Team form (#5) skipped — null at horizon 1.

**Planner implication:** the blanket γ≈0.84 is wrong per our data — team strength
should barely be discounted (flat), player form discounted only mildly (~79% at
8 GWs), minutes decayed gradually. Per-factor decay is justified and now measured.

## Study 1 verification (last run)

**team_elo 4,540 · team_form 9,072 · player_form 312,150.** No-lookahead:
**0 idle-team violations** (1 benign sub-precision draw).
Final 2023/24 ELO reproduces the real top 3 (MCI/ARS/LIV) and the three relegated
teams at the bottom; 2020/21 home-field anomaly reproduced from scratch. **ClubELO
Spearman rho = 0.95-0.99** across three dates (independent rank validation;
ClubELO never enters the model). Re-run all checks: `python -m analysis.verify_study1`
