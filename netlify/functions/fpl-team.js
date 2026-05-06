// Proxy for FPL team data. Combines entry info, squad picks, and player details
// into one response so the browser avoids CORS and doesn't need the full 400 KB
// bootstrap payload.
exports.handler = async function (event) {
  const teamId = event.queryStringParameters?.team_id;

  if (!teamId || !/^\d+$/.test(teamId) || Number(teamId) < 1) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing or invalid team_id" }),
      headers: { "Content-Type": "application/json" },
    };
  }

  const BASE = "https://fantasy.premierleague.com/api";

  try {
    // Fetch team info first — it contains current_event (active gameweek)
    const entryRes = await fetch(`${BASE}/entry/${teamId}/`);

    if (entryRes.status === 404) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Team not found — double-check your ID" }),
        headers: { "Content-Type": "application/json" },
      };
    }

    if (!entryRes.ok) {
      throw new Error(`FPL entry endpoint returned ${entryRes.status}`);
    }

    const entry = await entryRes.json();
    const gameweek = entry.current_event;

    if (!gameweek) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: "No active gameweek — try again once the season starts" }),
        headers: { "Content-Type": "application/json" },
      };
    }

    // Fetch picks and bootstrap in parallel now that we have the gameweek
    const [picksRes, bootstrapRes] = await Promise.all([
      fetch(`${BASE}/entry/${teamId}/event/${gameweek}/picks/`),
      fetch(`${BASE}/bootstrap-static/`),
    ]);

    if (!picksRes.ok) throw new Error(`FPL picks endpoint returned ${picksRes.status}`);
    if (!bootstrapRes.ok) throw new Error(`FPL bootstrap endpoint returned ${bootstrapRes.status}`);

    const [picksData, bootstrap] = await Promise.all([
      picksRes.json(),
      bootstrapRes.json(),
    ]);

    // Build lookup maps from bootstrap so we can enrich each pick in one pass
    const playerMap = {};
    for (const p of bootstrap.elements) playerMap[p.id] = p;

    const teamMap = {};
    for (const t of bootstrap.teams) teamMap[t.id] = t.short_name;

    const posMap = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

    const picks = picksData.picks.map((pick) => {
      const p = playerMap[pick.element];
      return {
        element_id:       pick.element,    // raw FPL player ID, used for squad exclusion
        element_type:     p ? p.element_type : null, // 1=GKP 2=DEF 3=MID 4=FWD
        position:         pick.position,   // 1–11 = starting XI, 12–15 = bench
        is_captain:       pick.is_captain,
        is_vice_captain:  pick.is_vice_captain,
        name:             p ? `${p.first_name} ${p.second_name}` : "Unknown",
        team:             p ? (teamMap[p.team] ?? "—") : "—",
        pos:              p ? (posMap[p.element_type] ?? "—") : "—",
        price:            p ? `£${(p.now_cost / 10).toFixed(1)}m` : "—",
        price_raw:        p ? p.now_cost : null, // integer tenths e.g. 55 = £5.5m
        total_points:     p ? p.total_points : 0,
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        teamInfo: {
          name:             entry.name,
          manager:          `${entry.player_first_name} ${entry.player_last_name}`,
          overall_points:   entry.summary_overall_points,
          overall_rank:     entry.summary_overall_rank,
          gameweek_points:  entry.summary_event_points,
          gameweek_rank:    entry.summary_event_rank,
        },
        gameweek,
        picks,
      }),
      headers: {
        "Content-Type": "application/json",
        // Short cache — picks can change during a live gameweek
        "Cache-Control": "public, max-age=60",
      },
    };

  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Failed to reach the FPL API", detail: err.message }),
      headers: { "Content-Type": "application/json" },
    };
  }
};
