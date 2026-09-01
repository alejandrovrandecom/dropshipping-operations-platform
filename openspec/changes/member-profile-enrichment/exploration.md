## Exploration: member-profile-enrichment

> Status: IDEA / PARKED. Seed note only — not yet a proposal. Do not start until
> `username-reservation-contract` (PR2 gates/resolver, PR3 typed API/docs) is
> merged, since this change extends the team-scoped resolver defined there.

### Problem: fragile identity

A globally unique username is a stable machine identifier, not a human identity.
Inside a team, members cannot tell whether `andresito1988` or `andresmilflover`
is the Andrés they know. The username alone forces recognition by an opaque
handle. This is the classic "fragile identity" problem that mature CRMs
(Salesforce, HubSpot, Intercom, Linear) solve by never showing a handle alone.

Decision already taken: usernames stay GLOBAL and immutable (see
`username-reservation-contract`). This change does NOT touch username scope.
It adds a human-recognition layer on top of the stable identifier.

### Industry pattern — three identity layers

| Layer | Field(s) | Purpose | Mutable |
|---|---|---|---|
| Identifier | `username` (global, existing) | Stable key, @-mention, attribution | No |
| Display | `full_name`, `avatar_url` | Recognize the person at a glance | Yes |
| Context | `role`, `timezone` | Disambiguate when names collide | Yes |

Golden rule the big CRMs apply: NEVER render the username alone. Always pair it
with avatar + real name; the username is the small, secondary line beneath.
UI shape (target, not built here):
`[avatar]  Andrés Gómez  /  @andresito1988 · Diseño`

### Proposed profile fields

Today `public.profiles` has only `user_id`, `email`, `display_name`,
`created_at` (`supabase/migrations/20260828170000_identity.sql:6-11`). No avatar,
no separate real name, no role, no location.

High value, low cost — include:
- `avatar_url` — the single strongest disambiguator (faces are recognized instantly).
- `full_name` — real display name (may reuse/replace `display_name`).
- `role` — functional role within the team ("Diseño", "Ventas").

Privacy-sensitive — handle with care:
- `timezone` — functional, low-sensitivity. Can be AUTO-DETECTED from the browser
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) with zero friction. Declared
  purpose: "show times in your local hour."
- `city` / `location` — personal data. OPTIONAL, never required. Declared purpose:
  "let your team know where you are."

### Anti-pattern explicitly rejected

DO NOT disguise `city` as `timezone` (or any field under a false label). Reasons:
1. Technically wrong — timezone ↔ city is not 1:1 (one tz spans many cities;
   distant cities share a tz), so a disguised field is ambiguous for BOTH uses.
2. Legally exposed — collecting personal data (location) under a false label
   violates GDPR Art. 5 transparency/purpose-limitation; audit and fine risk.
3. Erodes trust — a CRM lives on users trusting the data they enter; a discovered
   dark pattern is unrecoverable.
Correct approach: request each field honestly with its own declared purpose,
auto-detect timezone, keep city optional.

### Affected Areas (rough)

- `supabase/migrations/` — new columns on `profiles` (`avatar_url`, `full_name`,
  `role`, `timezone`, optional `city`), column grants, and extension of
  `resolve_team_usernames` (from username PR2) to return these display fields.
- `src/modules/identity/` — resolver/use-case updates to surface the richer member shape.
- `docs/{database,security}/` — schema/grant/ledger updates.
- Frontend — this change INTRODUCES user-visible UI, so it MUST run Impeccable
  `shape` per the project convention (see `username-reservation-contract`
  proposal Out of Scope).

### Open Questions

- [ ] Does `full_name` replace `display_name` or coexist with it?
- [ ] Is `role` free-text or an enum tied to membership?
- [ ] Avatar storage: Supabase Storage bucket vs external URL only?
- [ ] Should the enriched resolver stay one RPC or split display vs contact fields
      for finer-grained grants?
