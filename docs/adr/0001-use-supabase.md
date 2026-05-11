# ADR 0001 — Use Supabase as the SPAL backend

**Status:** Accepted  
**Date:** 2026-05-10

---

## Context

SPAL needs a backend that provides:
- User authentication (invite-only, not self-registration)
- A relational database with row-level access control
- Real-time updates for the live draft room
- Server-side functions for critical writes (draft picks, squad submission, scoring)
- File/blob storage for CSV uploads and legacy spreadsheet files
- Low operational overhead — this is a private league app, not a commercial product

Options considered:
- Firebase (Firestore) — good real-time support, but document model is awkward for relational league data
- PlanetScale / Neon + custom auth — more control, but significantly more operational overhead
- Supabase — Postgres with RLS, built-in auth, Realtime, Edge Functions, Storage, and a generous free tier

---

## Decision

Use Supabase for the entire SPAL backend:
- **Supabase Auth** for manager accounts and invite flow
- **Supabase Postgres** with Row Level Security for all persistent data
- **Supabase Realtime** for live draft board updates
- **Supabase Edge Functions** for critical server-side operations
- **Supabase Storage** for uploaded files

---

## Consequences

**Positive:**
- Relational schema with proper foreign keys suits the SPAL data model well
- RLS allows fine-grained access control without a custom API layer for reads
- Realtime is built-in — no separate WebSocket infrastructure needed
- Edge Functions handle critical writes without a separate server
- Supabase JS client handles auth, reads, and Realtime in one package
- Postgres is mature, well-understood, and testable

**Negative / constraints:**
- Edge Functions have cold start latency; acceptable for admin operations and squad submission, may be noticeable for draft picks during live draft — mitigate with keep-alive or warmed functions
- SPAL is coupled to Supabase's platform; migrating away would require significant effort
- Supabase free tier has row/storage limits; upgrade when the project scales

**Constraints this decision imposes:**
- Service role key must never reach the browser (Edge Functions only)
- RLS must be maintained correctly on every table; a misconfigured policy is a security issue
- Real-time draft updates depend on Supabase Realtime's availability and latency
