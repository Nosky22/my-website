// Proxy for the FPL bootstrap-static endpoint.
// The FPL API blocks browser requests with CORS headers, so the browser
// calls this function instead, and this function fetches on its behalf
// from Netlify's server environment where CORS doesn't apply.
exports.handler = async function () {
  const FPL_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";

  try {
    const response = await fetch(FPL_URL);

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `FPL API returned ${response.status}` }),
        headers: { "Content-Type": "application/json" },
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: {
        "Content-Type": "application/json",
        // Allow the browser to cache this for 5 minutes — the bootstrap
        // endpoint is large (~400 KB) and doesn't change mid-gameweek.
        "Cache-Control": "public, max-age=300",
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
