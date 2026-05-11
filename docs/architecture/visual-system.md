# SPAL Visual System

---

## Existing nosky.co.uk visual foundation

The following is derived from inspecting `style.css`, `index.html`, `fpl.html`, and `cyber.html`.

### CSS custom properties (design tokens)

```css
:root {
  --bg:             #0b2b2b;   /* page background — dark teal, NOT black */
  --bg-surface:     #0f3535;   /* header, footer, cards — slightly lighter teal */
  --text:           #ffffff;
  --text-muted:     #7fc4c4;   /* secondary text — teal-white, NOT grey */
  --cerulean:       #1a8fb5;   /* primary accent — links, active states */
  --cerulean-light: #4db8d8;   /* hover/focus accent */
  --yellow:         #f5c518;   /* hero titles, callouts */
  --max-width:      860px;     /* centred content width */
  --radius:         4px;       /* border radius throughout */
}
```

**Important:** The base palette is dark teal, not dark charcoal or near-black. Any SPAL planning documents that assumed `#0f0f0f` or similar are incorrect — the actual value is `#0b2b2b`.

### Typography

- **Font**: System stack only — no Google Fonts, no external font dependencies.
  ```css
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  ```
- **Base size**: 16px, `line-height: 1.6`
- No custom type scale beyond `clamp(2.5rem, 6vw, 4rem)` for the hero h1
- No monospace font currently defined

### Layout shell

```css
body {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
}

header {
  height: 60px;
  background: var(--bg-surface);
  /* flex row, space-between, sticky */
}

main {
  max-width: var(--max-width);  /* 860px */
  margin: 0 auto;
  padding: 3rem 1.5rem;
  flex: 1;
}

footer {
  background: var(--bg-surface);
  padding: 1.5rem;
  text-align: center;
  color: var(--text-muted);
}
```

The `body` is the full-height flex column. `main` is the sole flex child that grows. This structure must be respected or carefully isolated for SPAL.

### Nav dropdown (already implemented)

CSS classes `.nav-dropdown`, `.nav-dropdown-panel`, and `.nav-dropdown-panel.open` are already in `style.css` and used by `nav.js`. SPAL will inherit these for the main-site nav item.

### Patterns observed in HTML files

- `.hero` — centred text block with yellow h1 and muted subtitle
- `.page-intro` — text-muted intro paragraph
- `.feature-list` — icon + text list items
- `.app-placeholder` — card-style content area
- `.tag` — small inline badge (`.tag.green`, `.tag.yellow`, `.tag.grey`)
- `.fpl-*` — FPL-specific table, filter bar, button classes (not inheritable by SPAL)
- No shared card or table base class exists yet — SPAL will introduce its own

---

## What SPAL can inherit

These tokens and patterns transfer directly to SPAL's Tailwind/CSS layer with no modification:

| Token / pattern | Reuse note |
|-----------------|-----------|
| `--bg` `#0b2b2b` | SPAL page background |
| `--bg-surface` `#0f3535` | Panel, card, table header background |
| `--text` `#ffffff` | Body text |
| `--text-muted` `#7fc4c4` | Labels, secondary text |
| `--cerulean` / `--cerulean-light` | Links, active nav, interactive states |
| `--yellow` `#f5c518` | Score emphasis, champion callouts |
| `--radius` `4px` | All border-radius values |
| System font stack | No change needed |
| Nav dropdown structure | SPAL inherits the existing `/spal` dropdown item |
| `.tag` badges | SPAL can reuse or extend this pattern |

---

## SPAL-specific additions

These are required by SPAL but do not exist in the current site:

### Colour additions

```
Gold accent:      #d4a017 (slightly warmer than --yellow; league tables, trophies)
Surface-raised:   #153d3d  (modal dialogs, overlays — one step above --bg-surface)
Error:            #c0392b  (validation failures, deadline missed)
Warning:          #e67e22  (provisional data, open questions)
Success:          #27ae60  (confirmed, finalised rounds)
Disabled:         #4a6060  (locked inputs, past-deadline items)
```

### Nation badge colours (Six Nations)

```
England:    #ffffff on #cf081f
Ireland:    #ffffff on #169b62
Scotland:   #ffffff on #003893
Wales:      #ffffff on #d01012
France:     #ffffff on #002395
Italy:      #ffffff on #009246
```

Nation badges are informational. They must also show a text abbreviation (ENG/IRE/SCO/WAL/FRA/ITA) — colour alone is not sufficient.

### Typography additions

- Tighter line-height for data table rows: `1.3`
- Monospace for score columns: `font-variant-numeric: tabular-nums` (CSS feature, no new font needed)
- Heavier weight for standings positions and score totals: `font-weight: 700`

### Layout additions

- SPAL pages need a wider content area than `--max-width: 860px`. The draft board, standings table, and score breakdown all need `min-width: 960px`, ideally up to `1200px`.
- A SPAL sub-navigation bar sits between the main site header and page content on all `/spal/*` pages.
- Compact table rows: `line-height: 1.3`, `padding: 0.4rem 0.75rem`
- Budget bar: horizontal progress bar, cerulean fill on surface background

---

## Conflicts and risks

### `--max-width: 860px` is too narrow

The existing `main` element enforces 860px. SPAL's draft board, standings table, and squad builder require more horizontal space. Options:
1. SPAL's React app root overrides `max-width` within its own container (preferred — scoped CSS)
2. SPAL injects a different layout class on `body` (fragile — affects shared elements)

**Recommendation:** SPAL's app root element (`#spal-root`) sets its own `max-width: 1200px` via a scoped CSS rule, not by altering the global `main` style.

### `body` flex column conflicts with React root

The site's `body { display: flex; flex-direction: column }` and `main { flex: 1 }` assume a flat header/main/footer structure. If SPAL renders into a `<div id="spal-root">` inside `<main>`, it should work without conflict — `spal-root` becomes a flex child of `main`.

If SPAL ever needs to render its own full-height layout (e.g. draft room filling the viewport), it should use `position: fixed` or set `spal-root` to `height: 100%` — not modify `body` or `main`.

### No existing table or card CSS

The site has no shared `.card` or `.table` base styles. SPAL introduces these for the first time. They must be defined inside SPAL's own stylesheet (Tailwind layer or CSS module) and not bleed into the static site's pages.

---

## Implementation approach

1. Define SPAL colour tokens as Tailwind theme extensions in `tailwind.config.ts`, referencing the nosky CSS custom properties where the token is shared.
2. Define SPAL-specific tokens (gold, nation badges, semantic colours) as new CSS custom properties in `/spal/src/styles/spal-tokens.css`.
3. All shadcn/ui component themes are overridden to use SPAL tokens — do not use shadcn defaults.
4. CSS scope: all SPAL-specific styles live under `/spal/src/` and are bundled by Vite. They do not touch `style.css`.

---

## Component priorities

| Component | Purpose |
|-----------|---------|
| `LeagueTable` | H2H and total-points standings |
| `FixtureCard` | Single pair H2H fixture result or upcoming |
| `TripleFixtureCard` | Three-manager fixture result |
| `DraftBoard` | Full draft grid — all managers, all picks, by round |
| `DraftPickCard` | Individual draft pick — player, slot, manager |
| `PlayerBadge` | Compact: name, position, nation, price |
| `ManagerBadge` | Manager name and team name |
| `NationBadge` | Nation abbreviation + colour (text label required) |
| `PositionBadge` | Position abbreviation badge |
| `BudgetBar` | Visual budget usage bar |
| `ValidationPanel` | Squad validation errors and warnings |
| `SquadBuilder` | Interactive squad selection UI |
| `ImportIssueRow` | Single data quality issue in admin review list |
| `ScoreBreakdown` | Per-player score breakdown for a manager's round |
| `HistoryRecordCard` | Season summary card |
| `ChroniclePostCard` | Chronicle post preview card |

---

## Layout shell

SPAL pages use:

```
nosky.co.uk site header  (SPAL nav item active)
  SPAL sub-navigation    (league | draft | squad | standings | stats | history | chronicle)
  Page content           (max-width: 1200px, centred)
nosky.co.uk site footer
```

The SPAL sub-navigation is a separate component, rendered inside the React app, positioned below the inherited site header.

---

## Accessibility

- Desktop-first; mobile-compatible with horizontal scroll where necessary.
- Colour is never the only way to convey state — pair with text, icon, or pattern.
- Nation badges always show text abbreviation alongside colour.
- Semantic headings and ARIA landmark regions throughout.
- Keyboard navigation for draft room and squad builder where practical.
- Contrast ratios checked against `#0b2b2b` background (not assumed from a black base).
