## Exploration: launch-workspace-core

### Current State

The identity/team foundation (`identity-session-contracts`, archived) is the only implemented slice. It established the patterns this change must follow:

- **Schema pattern**: `supabase/migrations/` is the sole source of truth. Every table enables and forces RLS before any grant; every table starts from `revoke all` then issues explicit least-privilege grants; team-owned tables carry `NOT NULL team_id` plus `UNIQUE (team_id, id)` on parents so children cannot cross tenants; cross-cutting authorization logic lives in `SECURITY DEFINER` helpers (`is_team_member`, `is_team_owner`) with `search_path = ''`.
- **Existing tables**: `profiles` (mirrors `auth.users`), `teams` (tenant root, owner-governed), `memberships` (team-owned, composite key), `team_invitations` (hashed, expiring, single-use). No launch, checklist, template, or product-candidate table exists yet.
- **Module pattern**: `src/modules/identity/` is a thin three-file shape — `types.ts` (projects `Database` types, restates nothing), `repository.ts` (the only file touching Supabase, authorizes nothing — RLS is the wall), `service.ts` (use cases, depends only on the repository port). There is no framework around it.
- **No frontend exists.** `package.json` has exactly three runtime/dev dependencies: `@supabase/supabase-js`, `pg`, `vitest`. There is no Next.js, no `app/` directory, no pages, no components, no UI dependency of any kind. PRODUCT.md describes the stack as "planned" — App Router, Vercel — but nothing is scaffolded. Building UI in this change would mean bootstrapping the framework itself, not just adding a screen to an existing app.
- **Test pattern**: serial integration tests against a real local Supabase stack (`tests/support/local-stack.ts` mints tokens and opens direct Postgres/Supabase clients), organized by concern: `tests/database/` (module + reproducibility), `tests/identity/` (business flows), `tests/isolation/` (RLS/session denial proofs). No unit-test layer, no mocking — `testing.layers.unit: false` in `openspec/config.yaml`.
- **Docs pattern**: `docs/database/architecture.md` (ERD + ownership/RLS/grant/function ledger, updated every migration) and `docs/security/database-security.md` (threat-boundary table) are updated in the same PR as any schema change — treated as part of the change, not an afterthought.
- **Delivery pattern**: the prior change shipped as 4 stacked-to-main PRs (~220–320 lines each) inside one OpenSpec change, explicitly deferring frontend, revocation UX, and a combined "who am I" read contract as named follow-ups. That precedent — defer UI, ship schema+domain+tests+docs first — already exists in this repo for an even smaller surface (identity) than launch workspaces.
- **Confirmed product decisions** (PRODUCT.md + prior Engram spec `sdd/dropshipping-operations-platform/spec`): launch is a durable operational record, not a disposable task list; required checklist items gate activation, optional items never block it; templates are reusable but each application produces an independently editable snapshot that never mutates on future template edits; lifecycle states are draft, active, archived, discarded, trash, with restore recovering pre-trash state (no permanent purge) and reopening a discarded launch keeping the same record/history while starting a new eligible work cycle; team isolation is enforced at the database boundary; weekly/monthly goal credit comes only from a valid activation transition, Monday–Sunday in the team's timezone.

### Affected Areas

- `supabase/migrations/` — new forward migration(s) for launches (product-candidate record + lifecycle state), checklist templates and template items, per-launch checklist snapshot items, and an append-only launch event/history table. Must follow forced-RLS, revoke-then-grant, composite-tenant-key conventions already established.
- `src/modules/launch/` (new) — `types.ts` / `repository.ts` / `service.ts` mirroring `src/modules/identity/`, scoped to launch CRUD, checklist snapshot application, and lifecycle transitions.
- `docs/database/architecture.md` — new ERD entries, table/RLS/grant/function ledger rows, migration ledger entry.
- `docs/security/database-security.md` — new threat-boundary rows if launch data introduces new denial paths beyond the existing membership/session model.
- `tests/database/` and `tests/isolation/` — new integration and RLS-isolation tests proving required-item gating, snapshot immutability, lifecycle transitions, and team isolation for the new tables.
- `openspec/specs/` — a new domain directory (naming TBD — e.g. `launch-workspace`) since no baseline spec for launches exists yet.
- `package.json` — untouched if this slice stays database/domain-only; would require adding Next.js and UI dependencies if a web interface is included now.
- No existing file needs to change to support this feature — it is purely additive on top of `teams`/`memberships`, referencing `team_id` the same way `team_invitations` does.

### Approaches

1. **Database/domain-only slice (schema + repository/service + tests + docs, no UI)**
   - Description: Extend the established migration/module/test/doc pattern with launch, checklist template, snapshot, and history tables plus a `src/modules/launch/` port. Prove required-item gating, snapshot immutability, and lifecycle transitions through integration tests, the same way session validity was proven without any session-management UI.
   - Pros: Matches repo precedent exactly (identity-session-contracts shipped schema+domain+tests+docs and explicitly deferred UI); keeps review lines proportional to genuinely new risk (schema + RLS + business rules) instead of also absorbing framework-adoption risk; each PR stays well inside the 400-line budget; "usable" can be defined as provably correct and team-isolated, not yet click-through.
   - Cons: Does not yet deliver a screen a non-technical team member can use; PRODUCT.md's "minimal web interface" promise is still unmet after this change; risk that UI keeps getting deferred if not explicitly scheduled next.
   - Effort: Medium (schema design for snapshot immutability and lifecycle is the real complexity, not line count).

2. **Full minimal vertical slice including UI (schema + domain + Next.js scaffolding + one working page)**
   - Description: Do everything in Approach 1 plus bootstrap Next.js App Router from zero and ship at least a launch-list/launch-detail page backed by the new tables.
   - Pros: Directly delivers the PRODUCT.md "minimal web interface" promise in one change; a stakeholder can click through something real.
   - Cons: Conflates two unrelated risk classes (data-model/RLS correctness vs. framework bootstrap/design-system decisions) in one review; framework scaffolding alone (routing, layout, auth wiring, env plumbing) is a substantial, currently-undesigned surface with no DESIGN.md/PRODUCT.md UI conventions yet (Impeccable `init`/`shape` has not run); near-certain to blow the 400-line budget per PR and force ad-hoc splitting mid-flight instead of a planned one; no established component/design-system precedent to build against, so the UI itself would be improvised under schema-change time pressure.
   - Effort: High.

3. **Split into independently reviewable stacked units, but as one OpenSpec change with a schema/domain-first ordering and UI explicitly deferred to a separate follow-up change**
   - Description: Same target as Approach 1, but call out up front (in the proposal, not silently) that `launch-workspace-ui` is a distinct, named future change — not merely "TBD" — mirroring how `identity-session-contracts` named its deferred frontend/session-UX follow-ups explicitly in the proposal's Out of Scope section.
   - Pros: Keeps the same low-risk, precedent-matching delivery as Approach 1, but closes the "UI risk of being forgotten" gap by making the next change a first-class named commitment instead of an implicit gap.
   - Cons: None beyond Approach 1 — this is a proposal-writing discipline, not a technical difference.
   - Effort: Medium (same as Approach 1).

### Recommendation

Approach 3: ship `launch-workspace-core` as database/domain-only (schema, `src/modules/launch/`, integration tests, docs) and explicitly name a follow-up UI change in the proposal's Out of Scope section, exactly as the identity-session-contracts proposal did. This is the smallest coherent slice that produces a durable, team-isolated, testable launch record with lifecycle and checklist-gating behavior proven — without conflating untested framework-bootstrap risk into the same review as new tenant data-model risk. It also keeps every PR well inside the 400-line budget using the same stacked-to-main pattern already proven in this repo.

### Risks

- **Snapshot immutability semantics are undefined**: "template application creates an immutable launch-specific snapshot" needs a concrete schema shape (deep-copied rows vs. versioned template reference) decided before migration authoring, or the migration will need rework.
- **Lifecycle transition rules are incomplete**: draft/active/archived/discarded/trash states are named, but valid transitions, whether trash has any automatic expiry, and whether reopening a discarded launch is functionally identical to restoring from trash are not yet specified.
- **"Usable" is undefined**: the request says "the first usable team-isolated launch workspace" but also says a minimal web interface is part of the outcome, while confirming no frontend exists. Without a proposal-stage decision, "usable" could silently mean either "provably correct via tests" or "a team member can click a button" — these produce very different scope.
- **Goal-counter scope is ambiguous**: PRODUCT.md ties weekly/monthly goal progress to valid launch activations, but the deferral list in this request names only calculator, Dropi ingestion, analytics, and hosted email — goals are not mentioned either way and could be misread as included.
- **Checklist template authoring scope is unresolved**: shipping template CRUD (teams define their own required/optional items) is materially larger than shipping a fixed seeded template that launches snapshot from; conflating them risks scope creep mid-implementation.
- **OpenSpec domain naming collision**: no existing domain directory covers launches; the new spec directory name should be chosen deliberately (e.g. `launch-workspace`) to avoid ambiguity with a later `launch-workspace-ui` follow-up change.

### Ready for Proposal

No. Business-scope questions below must be resolved in the interactive product-question round before `sdd-propose` runs, so the proposal's In/Out of Scope split is decided by the user rather than assumed.
