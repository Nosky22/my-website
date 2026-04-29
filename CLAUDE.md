# my-website

Personal website hosting games, music, and small web apps.

## Purpose

A hub for creative projects: browser-based games, recorded music, and small interactive tools. The site should feel personal and handcrafted rather than like a template.

## Tech defaults

- **Plain HTML, CSS, JavaScript** — the default for everything unless there's a clear reason not to.
- **Phaser** — acceptable for games that need a game loop, physics, or sprite management.
- **React** — only when a project genuinely needs component-based UI (e.g., a tool with many interdependent interactive pieces). Not for simple pages.
- No build tools, bundlers, or transpilers unless a framework requires them.

## Design

- Dark theme throughout. Background near `#0f0f0f` or similar deep dark; text near `#e0e0e0`.
- Keep spacing generous and typography readable.
- Prefer CSS custom properties (variables) for colors and repeated values so the theme stays consistent.

## Code style

- Write comments that explain the *why* behind non-obvious decisions, not just what the code does.
- Keep functions small and names descriptive.
- Favor clarity over cleverness — this is a learning-friendly codebase.
- No minification in source files. The source should be readable.

## Workflow

- **Always explain what you're building before writing any code.** Describe the approach and ask if it sounds right.
- Prefer editing existing files over creating new ones when extending a feature.
- Don't introduce abstractions, helpers, or utilities until the same pattern appears at least three times.
- No frameworks, libraries, or dependencies added without explicit discussion.
