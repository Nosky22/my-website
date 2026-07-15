"""Study 1 parameters — ELO and rolling-form. All tunable; defaults justified.

Every value here is a modelling choice, documented so it can be challenged and
re-fit. Nothing is fit from the recorded window (walk-forward discipline): the
HFA regimes are fit from data PRIOR to 2020/21 (2018-19 + 2019-20).
"""
from __future__ import annotations

from datetime import date

# ── ELO ──────────────────────────────────────────────────────────────────────
ELO_START = 1500.0        # flat start for burn-in (2018-19); PL-only scale
ELO_K = 20.0              # standard football K; MOV multiplier applied on top
PROMOTED_ELO = 1350.0     # promoted teams enter ~1.5 K-games below mean
BOUNDARY_REGRESSION = 1.0 / 3.0  # regress 1/3 toward 1500 at each season start

# Home-field advantage, in Elo points, fit from PRIOR data (walk-forward clean):
#   normal: 2018-19 + 2019-20 pre-restart (N=668) → 49.7  [95% CI 26.6, 73.4]
#   bcd:    2019-20 post-restart (N=92)           → 53.3  [95% CI −7.6, 121.8]
# The bcd fit is statistically uninformative (CI swallows zero AND the normal
# estimate; point estimate is directionally wrong). The empty-stadium HFA
# collapse only became visible DURING 2020/21 (−8.2), which we may not use
# ex-ante. So bcd defaults to the normal value and 2020/21 is flagged
# crowd_conditions='behind_closed_doors' — its ratings knowingly over-credit
# home form. Override HFA_BCD (e.g. to ~0 on domain prior) and re-run if desired.
HFA_NORMAL = 49.7
HFA_BCD = 49.7            # = HFA_NORMAL pending decision; see note above

# Behind-closed-doors match window (by kickoff date): 2019-20 Project Restart
# through the end of 2020/21. Everything outside is 'normal'. Match-level by
# date (not season-level): 2019-20 itself straddles the boundary.
BCD_START = date(2020, 6, 1)   # ~2019-20 restart (first BCD match 17 Jun 2020)
BCD_END = date(2021, 7, 1)     # end of 2020/21; 2021-22 (Aug 2021) is normal


def hfa_for(kickoff: date) -> float:
    """Regime HFA for a match, assigned at match level by kickoff date."""
    if BCD_START <= kickoff <= BCD_END:
        return HFA_BCD
    return HFA_NORMAL


def regime_label(kickoff: date) -> str:
    return "behind_closed_doors" if BCD_START <= kickoff <= BCD_END else "normal"


# ── Rolling form windows ─────────────────────────────────────────────────────
# Store BOTH sizes; Studies 2–3 decide empirically which predicts better.
TEAM_FORM_WINDOWS = (6, 10)     # last-N *matches*
PLAYER_FORM_WINDOWS = (4, 6)    # last-N *gameweeks the player was active*

# Seasons we RECORD (fpl.seasons). Burn-in seasons (2018-19, 2019-20) warm the
# ELO but are never written.
RECORDED_SEASONS = ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
BURNIN_SEASONS = ["2018-19", "2019-20"]
FULL_XG_SEASONS = {"2022-23", "2023-24", "2024-25", "2025-26"}
