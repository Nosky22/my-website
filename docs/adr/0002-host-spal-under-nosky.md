# ADR 0002 — Host SPAL under nosky.co.uk at /spal/

**Status:** Accepted  
**Date:** 2026-05-10

---

## Context

SPAL needs a hosting location. Options:

1. **Separate domain** (e.g. `spal.nosky.co.uk` or `sergioapprec.com`) — clean separation, independent deployment
2. **Subdomain under nosky.co.uk** (e.g. `spal.nosky.co.uk`) — associated with the existing domain, separate Netlify site
3. **Sub-path under nosky.co.uk** (`nosky.co.uk/spal/`) — single Netlify project, shared navigation shell

SPAL is a private league for friends. It does not need to stand alone as a product. The commissioner already hosts nosky.co.uk on Netlify and wants SPAL to feel like part of the same personal site ecosystem.

---

## Decision

Host SPAL at `nosky.co.uk/spal/` within the existing Netlify project. SPAL is built as a separate Vite/React app whose output is placed under `/spal/` in the same Netlify deploy.

---

## Consequences

**Positive:**
- Single Netlify project — one deploy pipeline, one set of environment variables, one domain
- SPAL inherits the nosky.co.uk visual shell (header, footer, nav) naturally
- No separate DNS configuration or SSL certificate needed
- Simpler to manage for a single commissioner/developer

**Negative / constraints:**
- The SPAL build must coexist with the existing plain HTML/CSS/JS site in the same Netlify project
- `netlify.toml` must route `/spal/*` to the SPAL SPA and leave all other paths to the existing static files
- The Vite build output directory must not conflict with existing site files
- If SPAL were ever to become a separate product or handed to someone else, it would need to be extracted

**Future option:**
If SPAL outgrows this setup (e.g. requires a separate team, CI pipeline, or domain), it can be extracted to its own Netlify site and proxied under `nosky.co.uk/spal/` using Netlify rewrites. The `/spal/` routing contract can be preserved even if the underlying host changes.
