## Exploration: username-reservation-contract

### Current State

**No `username` concept exists anywhere in the repository** — no column, table, RPC, test, or doc references it (`rg username` is empty except this change's own exploration). `display_name` is a distinct, nullable, freely-editable field (`profiles.display_name`, grant `update (display_name)` only) and must not be conflated with the immutable username contract.

**Identity foundation** (`supabase/migrations/20260828170000_identity.sql`):
- `profiles.user_id uuid primary key references auth.users (id) on delete cascade`. Any username data stored only on `profiles` would be deleted the instant the account is (cascade fires on `auth.users` delete), which directly contradicts "permanently reserved after account deletion." This is why the approved scope requires a **permanent registry table independent of `profiles`/`auth.users` cascade** rather than a column on `profiles` — the registry is the mechanism that lets `username-reservation-contract` outlive the account it was claimed by.
- `handle_new_user()` fires `after insert on auth.users`, i.e., on **every signup**, before confirmation — Supabase issues the `auth.users` row immediately and only later flips `email_confirmed_at`. `supabase/config.toml` has `enable_confirmations = true`, so a session/JWT is not obtainable until confirmation completes. Net effect: a `profiles` row already exists, unconfirmed, before the moment this change cares about; the state this change must gate on is "has a valid JWT session" (post-confirmation) **and** "no registry claim exists for this `user_id`" simultaneously — both are already independently observable in the current schema, nothing new needs adding to detect the state, only to enforce a boundary on it.
- No RLS policy or RPC in this repo currently checks any per-account "onboarding complete" predicate. `teams_insert_self_owned`, `memberships_insert_owner`, `accept_invitation`, and every launch RPC in `20260829170000_launch_workspace_core` authorize purely on team membership/ownership — a confirmed, usernameless account can already create a team, invite members, accept invitations, and create launches today. The approved scope requires closing **all** of these, including `accept_invitation` explicitly, which is a cross-cutting authorization concern touching every existing write boundary, not a self-contained addition next to `profiles`.
- Existing precedent for atomic, race-safe, single-use claims: `accept_invitation` (single conditional `UPDATE ... WHERE ... RETURNING`, one atomic statement, uniform rejection message) and `create_invitation` (normalizes with `lower(btrim(...))`, validates format via regex, raises a domain error code). A `claim_username` RPC should follow this exact shape — a controlled `SECURITY DEFINER` write path, not a bare column grant — because immutability and reservation-atomicity are invariants a plain grant cannot express or protect.
- No existing read path resolves `user_id` to any human-readable identity for teammates — `repository.ts`'s `listMembers` returns raw `Membership` rows (`user_id` only). Team-scoped resolution is genuinely new surface, and per the approved contract it must stay **team-scoped**, not a global lookup: the registry itself must not be broadly `select`-granted, or any authenticated account could enumerate every claimed username platform-wide. Resolution has to be its own RPC/view joining the registry against live `memberships` for a shared team, mirroring how `is_team_member` already scopes every other cross-account read in this schema.
- **No frontend exists anywhere in this repository**, and this is now a decided, not open, fact for scope purposes. `package.json` has zero UI framework dependency (`@supabase/supabase-js` only); `src/` has no `app/`, `pages/`, or component tree; `PRODUCT.md`'s "Evidence on Hand" states outright there is *"no application implementation."* There is no `DESIGN.md` (Impeccable's `document` command has never run), though `PRODUCT.md` already carries the `impeccable:product-schema` marker from a prior `impeccable init`.

### Affected Areas

- `supabase/migrations/` — new forward migration: a permanent username registry table decoupled from `profiles`/`auth.users` cascade, retaining only the normalized username, the claiming `user_id`, and claim metadata (no `email`, no `display_name`, no other profile data duplicated into it); a normalization/format `CHECK` (lowercase, `a-z0-9_`, 3–30 chars); and a `claim_username(text)` `SECURITY DEFINER` RPC modeled on `accept_invitation`'s one-atomic-statement claim pattern.
- `supabase/migrations/` (same migration or a tightly-scoped follow-up) — an onboarding-gate helper function (mirroring `is_team_member`/`is_team_owner`) wired into **every** existing protected write path that currently has none: `teams_insert_self_owned`, `memberships_insert_owner`, `accept_invitation`, and every launch-creation RPC.
- `supabase/migrations/` — a team-scoped username-resolution RPC/view joining the registry against live `memberships`, with no broad `select` grant on the registry table itself, so resolution stays bounded to shared-team visibility rather than a global directory.
- `src/modules/identity/{types.ts,repository.ts,service.ts}` — add a `claimUsername` use case and a team-scoped `resolveUsernames`-style use case, following the existing thin repository→service wrapper shape. Note: `tests/database/identity-module.test.ts` hard-asserts the exact file list `["repository.ts","service.ts","types.ts"]` in this directory and that every `.from(...)` call in it targets only `["memberships","profiles","teams"]` — RPC calls (`.rpc("claim_username", ...)`, `.rpc("<resolution-rpc>", ...)`) don't trip that regex, but adding any new file to the directory will fail that test until it's updated, and the registry table name will need adding to that allow-list if any query reaches it directly.
- `src/lib/database.types.ts` — regenerated (`pnpm db:types`), not hand-edited.
- `docs/database/architecture.md`, `docs/security/database-security.md`, `docs/database/operations.md` (migration ledger) — this repo documents every migration's tables/grants/rollback note in the same PR; the registry table's asymmetric rollback (can't drop it without destroying permanent reservations) needs its own ledger row, same shape as `account-deletion-lifecycle`'s flagged FK-loosening risk.
- `tests/database/`, `tests/isolation/`, a new `tests/identity/username-reservation.test.ts` (mirroring `tests/identity/invitations.test.ts`) — claim success, normalization, format rejection, concurrent-claim race (only one winner), immutability (second claim attempt rejected), the onboarding-gate boundary re-tested against every currently-existing protected write path including `accept_invitation`, and the team-scoped resolution boundary (visible to shared-team members, not to outsiders or unrelated accounts).
- `openspec/specs/identity-session-contracts/spec.md` — the natural existing domain for a delta (it already owns profile/session boundary requirements); whether this warrants its own domain instead is a spec-phase decision, not this exploration's to make.
- No `src/app`, `src/components`, or any frontend path — explicitly out of scope for this change (see Recommendation).

### Approaches Considered

1. **Backend contract only — UI explicitly out of scope (approved)**
   - Description: Ship the permanent registry, `claim_username` RPC, normalization/uniqueness, the onboarding-gate helper wired into every existing protected write path (including `accept_invitation`), and team-scoped username resolution. No UI is built; the contract is enforced and testable end-to-end via RPC calls in Vitest, exactly like every other RPC in this repo today.
   - Pros: Fits the repo's actual current shape (backend-only, zero frontend). Directly unblocks `account-deletion-lifecycle`'s stated prerequisite (a durable, cascade-independent attribution identity), which only needs the *data contract*, not a UI. Testable with the exact patterns already proven (`accept_invitation`-style RPC test, `rls.test.ts`-style boundary test). Fits inside the 400-line review budget.
   - Cons: None material — the maintainer has explicitly separated the UI into its own future change, so "the flow isn't user-visible yet" is accepted scope, not a gap.
   - Effort: Medium.

2. **Bootstrap the actual registration/onboarding UI now (rejected for this change)**
   - Description: Stand up Next.js App Router for the first time in this repo, build signup/confirmation/username-onboarding pages, and route a confirmed-no-username session into a mandatory onboarding screen.
   - Why rejected here: would make this change the first UI ever built in the product — full framework scaffold, session/auth wiring, routing shell, and initial design-system decisions, bundled into a change about a data contract. Conflates two independent large risk classes, the same category error `account-deletion-lifecycle`'s own exploration already flagged for bundling `pg_cron`/`pg_net`/Vault into a change already carrying FK-loosening risk. The maintainer has resolved this explicitly: UI is a **separate future SDD change**, and that future change must run Impeccable `shape` before design/implementation.

3. **Split backend contract and UI into ordered work units of the same change (rejected)**
   - Why rejected: reorders the same disproportionate scope rather than avoiding it — the UI work unit would still have to bootstrap the entire product's first-ever frontend from zero inside a change framed around username reservation. Superseded by the maintainer's decision to keep them as separate changes.

### Recommendation (approved scope)

**Backend-first only**, as decided by the maintainer:
- A permanent username registry table, independent of `profiles`/`auth.users` cascade, storing no email and no full profile data.
- An atomic `claim_username` RPC (immutable, one claim per account, normalized lowercase `[a-z0-9_]`, 3–30 chars, globally unique).
- A complete onboarding gate covering **every** existing protected write, explicitly including `accept_invitation`, not just team/launch creation.
- Team-scoped `user_id`-to-username resolution (bounded to shared-team visibility, not a global directory).
- Actual UI is out of scope for this change. It is a separate, future SDD change, and that change **must** run Impeccable `shape` before design/implementation, per `gentle-impeccable`'s decision gate for a genuinely new surface (no `DESIGN.md` exists yet, and `PRODUCT.md` confirms no application implementation exists anywhere in the product). `impeccable init` has already run once (`PRODUCT.md` carries the schema marker), so that step will not need to repeat when the UI change starts.

### Risks

- **Registry `user_id` linkage strategy needs a deliberate design decision**: the registry must survive account deletion (no cascade), but claiming still needs to validate against a real, currently-authenticated account. Whether the registry's `user_id` column carries no FK at all, or an FK with an explicit non-destructive action, is a design-phase decision, not resolved by this exploration — get it wrong and either deletion becomes blocked (`restrict`) or the registry silently loses its `user_id` link (`set null`) in a way that isn't yet specified as acceptable.
- **Cross-cutting bypass surface**: the onboarding gate must touch every *existing* protected write path (`teams_insert_self_owned`, `memberships_insert_owner`, `accept_invitation`, all launch RPCs) — a wider blast radius than a typical single-table feature, needing the same care as the FK-loosening risk already flagged in `account-deletion-lifecycle`'s exploration. Missing even one existing entry point leaves a bypass.
- **Team-scoped resolution must not leak globally**: if the registry table (or any view over it) is granted a broad `select`, team-scoping is defeated and any authenticated account can enumerate every claimed username platform-wide. The resolution path must be RPC/view-mediated and scoped by live `memberships`, matching this repo's `is_team_member`-gated read pattern.
- **Concurrent claim correctness**: normalization + uniqueness must be enforced atomically (constraint + single conditional statement, per `accept_invitation`'s pattern), not check-then-insert, or two simultaneous claims of the same normalized string can both appear to succeed at the application layer.
- **Rollback asymmetry**: consistent with this repo's forward-only convention, a follow-up migration can revoke `claim_username`'s `execute` grant, but the registry table itself cannot be dropped without destroying permanent, contract-mandated reservations once any username has been claimed — the same class of one-way risk `account-deletion-lifecycle` already flagged for its FK loosening.
- **Existing-account handling is explicitly out of scope**: per the given contract, local/test identities may be recreated pre-production, so no backfill/migration-of-existing-accounts path is required — confirmed against the repo (no seeded or production account data exists to migrate).

### Dependencies

- **`account-deletion-lifecycle`** (paused, active change) — this change is its explicit prerequisite: the permanent registry is the mechanism that lets a deleted account's username survive as durable historical attribution, replacing the ad hoc "alias/PII" idea that change's own exploration had flagged as undecided.
- **Future UI/onboarding-flow SDD change (not yet created)** — depends on this change's `claim_username` and resolution RPCs as its backend contract; must run Impeccable `shape` before its own design/implementation, per the maintainer's decision.
- **`identity-session-contracts`** (archived foundation) — `profiles`, `teams`, `memberships`, `team_invitations`, `is_team_member`/`is_team_owner` helpers. No changes to that foundation's existing columns are required; this change layers new objects, one new gate helper, and gate predicates onto existing policies/RPCs.
- No other in-flight change conflicts.

### Open Product Questions

None remaining. All questions raised in the prior exploration round are resolved by the maintainer's approved decisions:

| Prior question | Resolution |
|---|---|
| Is UI in scope for this change? | No — backend-first only; UI is a separate future SDD change. |
| Should the change framing make the backend-only scope explicit? | Yes — renamed from `profile-username-onboarding` to `username-reservation-contract`. |
| Where does the reservation/tombstone data live? | A permanent registry table, independent of `profiles`/`auth.users` cascade, storing no email or full profile. |
| Should `accept_invitation` be gated by onboarding completion? | Yes — explicitly included in the complete onboarding gate. |
| Is teammate-facing username resolution in scope? | Yes — team-scoped `user_id`-to-username resolution, not a global directory. |
| Must the gate retroactively cover every already-shipped protected write path? | Yes — "every existing protected write" is explicit approved scope. |

### Ready for Proposal

**Yes.** Scope, registry architecture direction, gate coverage, resolution boundary, and UI separation are all resolved by maintainer decision. Remaining detail (exact registry column layout, the `user_id` FK/no-FK strategy, and domain-spec placement) belongs to `sdd-propose`/`sdd-spec`/`sdd-design`, not to a further exploration round.
