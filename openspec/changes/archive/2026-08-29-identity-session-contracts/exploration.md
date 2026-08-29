## Exploration: identity-session-contracts

### Executive Summary (plain language)

Today, logging in and staying logged in is handled entirely by Supabase's built-in
authentication service — our own code does not manage sessions at all. The database
double-checks, on every single request, whether the logged-in person still belongs
to the team they're asking about. That's good: kicking someone out of a team takes
effect immediately, even if their login session is still technically valid for
another hour.

But we found one real gap: if a person changes the email address on their account,
our copy of that email (used to match team invitations) never updates. It's only
copied once, when the account is first created. This could cause a pending
invitation to fail to match, or match against a stale address. This is small,
concrete, and fixable in one focused change — that's what we recommend for the
next work unit, together with writing down and testing the exact rules for when a
login session is considered valid or invalid.

We are NOT recommending "sign a user out of every device" as part of this change —
that requires an admin-level capability we don't have yet and raises questions
only the product owner can answer (see "Questions to answer before proposal").

### Current State

- Session handling is delegated entirely to Supabase Auth (GoTrue). There is no
  custom session table, sign-out endpoint, or token-management code anywhere in
  the repository — `src/modules/identity/*` only wraps `teams`/`memberships`
  reads and team creation (`repository.ts`, `service.ts`).
- `supabase/config.toml` sets `jwt_expiry = 3600` (1 hour access token),
  `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`,
  and email confirmation is required (`enable_confirmations = true`).
- Authorization is **not** cached in the JWT. Every policy re-checks live table
  state via `is_team_member(uuid)` / `is_team_owner(uuid)` (both
  `security definer`, empty `search_path`, granted to `authenticated` only).
  This means a membership removal takes effect on the *next request*, not only
  after the JWT expires — already proven by
  `tests/isolation/rls.test.ts:93-99` (owner removes member → member's own
  client immediately loses team visibility, same session, no re-login).
- `profiles` mirrors `auth.users` via `handle_new_user()`, but the trigger only
  fires `AFTER INSERT ON auth.users` (`supabase/migrations/20260828170000_identity.sql:55-65`).
  There is no `AFTER UPDATE` trigger, so `profiles.email` is a one-time copy,
  not a live mirror.
- `accept_invitation(token)` matches the invitation's stored recipient address
  against `profiles.email` (looked up via `auth.uid()`), not against
  `auth.users.email` directly (`supabase/migrations/20260828210000_team_invitations.sql:63`).
- Existing session-boundary test coverage: anonymous caller (no read/write),
  a correctly signed but expired token, and tampered/expired/wrong-recipient
  invitation tokens. Not covered: a JWT with a tampered *signature* on an
  ordinary request (only the invitation token itself is tested for tampering),
  refresh-token rotation/reuse behavior, or a sign-in attempt before email
  confirmation.
- **No OpenSpec baseline exists yet.** `openspec/specs/` only contains
  `.gitkeep`; the two prior changes (identity foundation, team invitations)
  shipped without a formal delta spec in this convention. This will be the
  first change to go through `sdd-spec`.

### Affected Areas

- `supabase/migrations/20260828170000_identity.sql` — `handle_new_user()` trigger
  scope; likely needs a companion `AFTER UPDATE` trigger (new forward migration,
  this file is immutable per the migration ledger convention).
- `supabase/migrations/20260828210000_team_invitations.sql` — `accept_invitation`
  reads `profiles.email`; behavior depends on the sync fix above.
- `docs/security/database-security.md` — "Threat boundaries" and "Enforced
  denials" tables must gain a session-validity row/entry if scope expands there.
- `docs/database/architecture.md` — "Functions and triggers" table and ERD must
  be updated in the same PR as any new trigger, per this file's own rule.
- `tests/isolation/rls.test.ts` — natural home for new session-validity denial
  proofs (signature tampering, unconfirmed-email sign-in).
- `tests/identity/invitations.test.ts` — needs a case proving invitation
  matching survives (or correctly fails) an email change.
- `src/modules/identity/*` — no code change expected unless the product wants a
  new read-only "who am I" surface (see Approach 2 below); currently out of the
  narrow recommendation.

### Approaches

1. **Profile identity sync + session-validity contract (narrow)** — Add an
   `AFTER UPDATE OF email ON auth.users` trigger so `profiles.email` stays a
   live mirror, and write the delta spec + tests that formalize the already-
   working "authorization is never cached in the session" behavior plus the
   currently-untested denial paths (tampered JWT signature on an ordinary
   request, sign-in before email confirmation).
   - Pros: Closes a real, concrete correctness/security gap; stays well inside
     the review budget; follows the exact RLS-first / `SECURITY DEFINER`
     checklist already established; no new runtime surface (no new edge
     function, no new client-facing API).
   - Cons: Does not address session *termination* (forced sign-out); leaves
     "who am I" convenience reads unaddressed.
   - Effort: Low.

2. **Add a read-only "current identity" contract** — A `security definer`
   RPC (or view) that returns the caller's profile plus every team membership
   and role in one call, so a future frontend does not need N+1 calls to
   `is_team_owner` per team.
   - Pros: Useful forward-looking contract; still read-only, so it cannot
     widen the write surface.
   - Cons: Speculative without a frontend consumer yet — risks building an
     API shape nobody has confirmed; blends "session contract" with "identity
     read API," which may deserve its own change.
   - Effort: Medium.

3. **Session termination / revocation contract (broad)** — Define and
   implement forced sign-out (e.g., on membership removal, password change, or
   a user-initiated "sign out everywhere"), using Supabase's admin-level
   session/refresh-token revocation.
   - Pros: Closes the theoretical "stale JWT for up to 1 hour" window
     completely.
   - Cons: Requires a privileged (`service_role` or Auth Admin API) capability
     that does not exist in this repo yet; meaningfully larger surface (new
     edge function, new secret handling, new test harness against GoTrue admin
     endpoints); the current live-RLS design already prevents data access
     during that window, so the residual risk is narrow. Very likely exceeds
     one reviewable change on its own.
   - Effort: High.

### Recommendation

Approach 1. It is the smallest change that turns "identity session contracts"
into something concrete and provable: it fixes a real bug (stale profile
email), and it writes down — as spec + tests — the session-validity guarantees
the system already relies on but has never stated explicitly. Approaches 2 and
3 are legitimate future work but should be separate changes once the product
questions below are answered.

### Risks

- **No baseline spec to delta against.** `sdd-spec` for this change will need
  to either backfill baseline requirements for existing identity/team/
  invitation behavior or explicitly scope the delta to session-validity and
  profile-sync requirements only, citing `docs/database/architecture.md` and
  `docs/security/database-security.md` as the informal baseline. Flag this to
  the user before `sdd-propose` locks scope.
  - **Denial path**: this exploration proposes only, does not decide it — the
    scope decision belongs to `sdd-propose`/`sdd-spec`. If left unresolved,
    the delta spec has no anchor and reviewers cannot tell "new" from
    "restated."
- **`AFTER UPDATE` trigger scope.** Supabase Auth only writes a confirmed
  new address to `auth.users.email` after the user verifies it (both old and
  new address confirmation, depending on config). The trigger must fire on the
  confirmed value, not on an in-flight, unconfirmed change — needs explicit
  product/technical confirmation before design.
- **Migrations are immutable.** The fix must ship as a new forward migration,
  never an edit to `20260828170000_identity.sql`, per the migration ledger
  rule in `docs/database/architecture.md`.
- **Scope creep risk.** "Session contracts" invites scope into sign-out,
  MFA, and rate-limiting territory that this repo has never touched. The
  recommendation above deliberately excludes those to protect the 400-line
  review budget.

### Questions to Answer Before Proposal

1. If we remove someone from a team, is a same-session data-access cutoff
   (already true today) enough, or does the business require forcibly ending
   their login session too, accepting the added complexity from Approach 3?
2. Should a user's copied email (`profiles.email`) update automatically the
   moment Supabase confirms an email change, or does that need an explicit
   re-verification step against pending invitations first?
3. Is a "sign out everywhere" or "sign out this device" user-facing capability
   required in this cycle, or is it explicitly deferred?
4. Do we need a single "who am I / my teams and roles" read contract now (Approach 2),
   or is per-team `is_team_owner`/`is_team_member` calls sufficient until a
   frontend exists?
5. Is there a business requirement for login rate-limiting or lockout beyond
   Supabase Auth's defaults, or is that explicitly out of scope for now?
6. Should password reset / account-recovery flows be covered by this change,
   or treated as a separate future work unit?

### Ready for Proposal

**Conditional — No.** The narrow recommendation (Approach 1) is scoped and
low-risk enough to propose, but questions 1, 2, and 3 above materially affect
its boundaries (especially whether Approach 3 pieces sneak into "session
contracts" scope) and should be answered first. Tell the user: the technical
investigation is complete and one safe path is identified, but a short product
decision is needed on session-termination expectations before `sdd-propose`
locks scope.
