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

## Study 3 resolutions (pre-Study-4)

`study3_resolutions.py`. **R1 — ELO construct:** Study 2 #3 was fixture-RELATIVE
ELO (0.22 MID contemporaneous); Study 3 decay was team-strength-ALONE (0.09).
Re-measured the planning-correct construct (own ELO as-of t − *scheduled*
opponent's ELO as-of t): **higher and FLAT** (DEF single-GW 0.19→0.14 over 10
GWs vs 0.12 alone) — the non-decaying long-horizon anchor, DEF benefits most.
**R2 — form vs minutes:** partial controlling BOTH own baseline AND recent
minutes — form **survives** (MID partial ρ 0.10→0.21) so it's genuine role/change
signal, but ~half of raw form is the minutes/baseline channel → planner uses form
at its *partial* (incremental) weight, not raw.

## Study 4 — Player archetypes  ✅ (proposed table pending approval)

`study4_archetypes.py` · `run_study4.py`. Axis = **stability** (start_rate =
starts/season-GWs), quality (ppg) kept separate. 2,476 player-seasons:
nailed 501 / rotation 1,054 / fringe 921. Face-valid (nailed core = Salah, Isak,
Palmer, Haaland; "nailed but poor" = O'Shea, Faes — proving core≠good).

**Cross-season persistence (the key question) — MODERATE:** start_rate ρ = 0.51
S→S+1; nailed stays nailed 51% (vs 20% base = **2.5× chance**) but ~39% drift to
rotation. A **usable prior for GW1 drafting, not a deterministic label** — must
be updated with pre-season news. 3rd-archetype (nailed×fixture-sensitivity):
27% of nailed show sensitivity >0.25 — suggestive but per-player-noisy;
recommend storing sensitivity as a continuous field, not a hard 3rd bucket.
`fpl.player_archetypes` table proposed for approval before populating.

## Study 5 — team strength × archetype (tight: one new interaction)  ✅

`study5_interaction.py`. Not a re-run — team form is null beyond baseline
(Study 2 #5) and ELO→points-by-position is measured (R1). The one new question:
does team strength translate to points more for **nailed** than **rotation**
players, within position?

- **Starters (given playing): nailed ≈ rotation** (DEF 0.279 vs 0.283) — a clean
  sheet is a clean sheet regardless of nailed-ness.
- **Total value (all rows): nailed ≫ rotation** (DEF 0.244 vs 0.138; GKP ~1.9×;
  FWD ~2.2×) — because nailed players actually **start** the good fixtures while
  rotation players leak the benefit by missing games.

**So nailed-ness is the MULTIPLIER on team strength** — "premium team **nailed**
defence" is the cleanest bet; a cheap rotation defender on a great defensive team
is a trap (team strength you can't bank if you're not playing). Directly feeds
Study 6. Team-form null noted, not re-opened.

## Value-engine design rules (locked from Studies 1–5)

Recorded in `insights` (`value-engine-design-rules`) — hard rules for the value
engine + planner: (1) form at PARTIAL not raw; (2) fixture-adjusted relative ELO
is the long-horizon anchor (never naked ELO / raw FDR); (3) nailed-ness multiplies
team strength; (4) core ≠ good (stability ⟂ quality); (Tier-1) archetype is a
last-season prior, surfaced WITH correctable context.

## Study 6 — undervaluation (the core edge)  ✅ (negative — thesis not supported)

`study6_xpts.py` (Phase A) · `study6b_ownership.py` + `run_study6b.py` (Phase B).
Both phases were **pre-registered** (success criteria fixed before measuring)
because two predictions had already failed and the discipline exists to stop
p-hacking. Writes `insights` rows `study6-phaseA-xpts-accuracy`,
`study6-phaseB-ownership`.

**Phase A — the point estimate.** Built a 5-signal expected-points model
(fixture-adjusted rel-ELO over the horizon, partial form, base ppg, start-prob,
nailed×strength interaction) and gated it against naive baselines at the
**hold horizon** (cumulative points t+1..t+n, walk-forward). Result: **the
engineered edge over season-to-date ppg decays monotonically to zero** — DEF
+0.027 (t+1) → +0.013 (t+3) → **+0.000 (t+6)**; MID/FWD the same; PPM no better.
Fixture difficulty averages out over a window, and ppg already carries
quality×availability. **So hold-value IS ppg** (RULE_5). The +0.02 single-GW
edge is real and replicated (5/5 seasons) but **short-horizon only** — scoped to
captaincy/XI/bench (RULE_6). GKP uses a base_ppg fallback (features add noise).

**Phase B — the ownership/mispricing term**, on the honest ppg base. Two
distinct pre-registered questions + the Study-5 nailed-ness guard. Ownership
recovered multi-season from raw vaastav `selected` counts (archive) + DB
`selected_by` (2025/26), **normalised to within-GW percentile among the decision
set** before pooling (monotonic rank → counts and %s comparable). 108,825
decision rows.
- **(a) PREDICTIVE — NULL.** partial ρ(ownership, subsequent | ppg) = **+0.009**
  pooled, negative in only 1/6 seasons. Ownership adds nothing beyond ppg, and
  the tiny sign is *positive* (owned players do marginally better) — the opposite
  of undervaluation. (GKP +0.17: keeper ownership is a *quality* signal.)
- **(b) MISPRICING — NULL, and the portfolio is actively adverse.** No
  ex-ante category clears the bar (best MID +0.094, 2/6 seasons). Decisively, the
  **decision portfolio**: among top-tercile-ppg players, the **low-owned half
  scores FEWER subsequent points than the high-owned half in all 6 seasons**
  (~13.4 vs ~18.4; pool ~15.9; hit-rate 0.37–0.43 < 0.50). The field is right —
  low ownership of a good-ppg player mostly encodes *correct* information
  (rotation/injury/role loss) ppg hasn't caught up to.
- **GUARD — fails as predicted, and that is the point.** The raw "high ppg +
  low ownership" top-20 is **80–95% rotation/fringe every season**. Unguarded,
  undervaluation is a rotation-trap generator — exactly Study 5 / RULE_3's
  warning. The nailed-ness guard is **load-bearing, not optional**.

**Conclusion (stated plainly, per the pre-registration):** undervaluation as a
*points-alpha* edge is **not supported** — the field is ~efficient on
established players. What survives is the narrower, guard-dependent claim the
mini-league thesis actually needs: **differentials are a VARIANCE tool for
rank-chasing when trailing** (which does not require ownership to predict
returns), and only a **nailed** low-owned player is a good differential — a
low-owned rotation player is just downside. Points prediction is settled at ppg;
the value engine's job is trust-adjustment + variance/differential framing, not
finding underpriced points.

## Study 7 — set-and-forget optimal squad  ✅ (the reusable ILP core)

`optimizer.py` (the ILP core, unit-tested in `test_optimizer.py`) ·
`study7_optimal.py` · `run_study7.py`. **New dependency: PuLP** (CBC solver,
user-approved). `python -m analysis.test_optimizer` runs the constraint tests;
`python -m analysis.run_study7` runs the study (~48s, all seasons solve to proven
Optimal). Writes `insights` row `study7-set-and-forget-ceiling`.

**The core (`optimizer.py`)** is a general squad ILP so it can be reused for the
transfer planner (§5.10) and the season-path Tier-1 draft (§5.13). Constraints
(all unit-tested): squad 2/5/5/3 = 15, budget £100m, ≤3 per club; per-GW XI of 11
with a valid formation (1 GK, DEF 3-5, MID 2-5, FWD 1-3), start only if owned;
exactly one captain (points doubled). Objective = Σ started points + captain's
extra 1×. XI/captain vars are restricted to a generous top-K/position (bench-filler
reduction); **K-stability verified** (K=45 and K=80 give the identical 2025/26
ceiling, 3101).

**The hindsight ceiling** (best legal 15 at GW1 prices, unchanged, optimal
XI+captain each GW) is remarkably stable at **~3,010–3,175 pts/season**. It is a
CEILING, not an achievable target — nobody picks it ex ante (recorded caveat).
2025/26 gap (only season with cohort data): ceiling **3101** vs best of 150 elite
managers **2582** (+519), elite median 2493, me **2007** (+1094). Even the best
elite manager left ~500 pts on the table.

**Cross-season archetype pattern (the legitimate GW1-draft signal — asking what
KINDS, not which names):**
- **NAILED dominates: 79/90 slots (88%), 0 fringe.** The 11 "rotation" tags are
  last-season-archetype *prior misses* that paid off (Palmer '23/24, Haaland's
  injury-hit '23/24 minutes) — the known ~39% drift, and exactly why the prior is
  updatable, not a label (TIER1 rule).
- **Spend structure is consistent:** cheap keeper (mean £4.9), cheap/mid defence
  (mean £5.2; ⅔ of optimal DEFs under £5.5), premium midfield (mean £7.8, with a
  £12–13 Salah-tier anchor most seasons), premium-ish forwards (mean £8.4, a
  £10.5–14 Haaland/Kane anchor). The template: **1–2 mega-premium attackers
  funded by cheap nailed defenders and an enabler keeper.**
- **Promoted-team bargains DO NOT recur: 0/75 slots** (2021/22–2025/26; 2020/21
  excluded — no prior season, though Bamford/Leeds would have qualified). A clean
  *negative* — newly-promoted clubs are too volatile to anchor a GW1 set-and-forget,
  even if they yield good mid-season picks. Refutes that hypothesis for drafting.

This validates the nailed-ness thesis hard (Study 5 / RULE_3) and gives Tier-1 a
concrete draft prior: nailed players, premium at the top of attack, cheap nailed
defenders as enablers, don't reach for promoted-club punts.

## Study 8 — elite-manager behaviour  ✅ (descriptive; closes Phase 1)

`study8_behaviour.py` · `run_study8.py` → `insights` row `study8-elite-behaviour`.
**DESCRIPTIVE, NOT CAUSAL** — 150 managers (top-150 in 2025/26), ONE season, and
**123/150 have no prior top-10k track record** (survivorship). Pre-registered;
we expected nulls. Classification by prior top-10k finishes: **SC** ≥2 (n=10, the
better evidence) · MID 1 (n=17) · **NT** 0 (n=123).

- **(1) Chip returns (within-manager — the defensible core).** Chip-week points
  vs each manager's own non-chip mean: **Bench Boost +34 (90% of uses beat own
  baseline)** and **Triple Captain +20 (92%)** pay reliably and mechanically;
  **Free Hit +7 (64%)** marginal; **Wildcard +5 (60%, misses the bar)**.
  CAVEAT: chips are played in double-gameweeks, so the delta conflates chip
  mechanic + DGW + timing. For BB/TC a real mechanical gain remains; **for WC/FH
  the within-week delta is mostly "played into a good week", not chip value**
  (WC's real value is squad quality over *following* weeks, which this
  under-measures).
- **(2) Chip timing prior.** Second-half chips **cluster GW30–37** (the DGW/BGW
  run-in): WC best window 32–36 (45%), FH 30–34 (50%), BB 33–37 (45%) — all
  usable priors. **Triple Captain has NO tight window** (best 29%) — played
  opportunistically on any premium's big fixture. First-half chips are spread.
  Half split is ~150/150 (forced by the once-per-half expiry), so uninformative.
- **(3) SC vs NT — NULL.** The skill-consistent 10 are **behaviourally
  indistinguishable** from the 123 no-track on every axis: final ~2494 vs 2498,
  transfers ~38, hits ~1.1, chip median GWs near-identical. Either the behaviours
  that matter aren't in this feature set, or the cohort is homogeneous because all
  are elite *this* season — we **cannot separate skill-behaviour from luck** here.
- **(4) Captaincy is heavily herded** — 76% of the cohort on the modal captain
  each GW (SC 78% ≈ NT 76%); flip-flops ~11/manager, no group difference. Top-end
  captaincy is templated; differential captaincy is rare even among the elite.

**Usable takeaways for my planning (priors, not causal claims):** BB and TC are
the point-bearing chips — plan them onto confirmed doubles; hold TC for a premium's
standout fixture rather than a fixed GW; line the second WC/FH/BB up for the
GW30–37 run-in. Everything else (who's "skilled", transfer cadence) is
indistinguishable noise in one season.

## Draft-template / GW1 tool — pre-registered backtest  ⚠️ (projection layer refuted)

`optimizer.solve_squad_by_value` (squad knapsack + structural template hooks,
unit-tested) · `draft_projection.py` (walk-forward priors, no lookahead) ·
`draft_backtest.py` + `run_draft_backtest.py` → `insights` row `draft-gw1-backtest`.

Before building the tool, a pre-registered three-way backtest (target seasons
2021/22–2025/26, each projected from prior seasons only, all arms scored on
**actual** GW1–10 points with optimal XI+captain):
- **NAIVE** — last-season total points under squad constraints (what an unaided
  manager does).
- **TEMPLATE** — same objective + Study 7's structural shape (cheap enabler GK,
  cheap DEF ≥4 nailed, ≥1 mega-premium attacker). No projection machinery.
- **PROJECTION** — the full discounted GW1–10 projected-points ILP
  (`start_rate × ppg_started × fixture_mult`, γ=0.92).

**Result — NAIVE wins all five seasons.** Projection −377 pooled (0/5), template
−180 pooled (0/5). A diagnostic arm (projection scored as an all-15 knapsack, to
separate signal from the set-and-forget bench structure) still lost −162 (1/5) —
so **both the decomposed signal and the bench structure cost points**. Same lesson
as Study 6: the simple aggregate (last-season total) beats the engineered
decomposition; the fixture tilt averages out over GW1–10 and adds noise.

**Implication (pre-registered):** the projection layer is **not built**. The GW1
tool is downgraded to **naive-optimal (last-season total under real constraints) +
Study-7 template as a displayed lens, not a constraint + newcomers surfaced for
judgement.** γ note preserved in `draft_projection.py`: γ modelled plan-revision +
prior uncertainty, NOT signal decay — do not "fix" it to 0.84.

**Tier-C (no-prior newcomers) share of the retrospective GW1–10 ceiling:** 0–6%
in recent seasons but **19% in 2022/23** (Haaland's debut) — usually small,
occasionally decisive when a marquee signing debuts. So the manual-include /
judgement path is a tail-risk hedge, surfaced prominently but rarely load-bearing
for the opening block.

## Study 1 verification (last run)

**team_elo 4,540 · team_form 9,072 · player_form 312,150.** No-lookahead:
**0 idle-team violations** (1 benign sub-precision draw).
Final 2023/24 ELO reproduces the real top 3 (MCI/ARS/LIV) and the three relegated
teams at the bottom; 2020/21 home-field anomaly reproduced from scratch. **ClubELO
Spearman rho = 0.95-0.99** across three dates (independent rank validation;
ClubELO never enters the model). Re-run all checks: `python -m analysis.verify_study1`
