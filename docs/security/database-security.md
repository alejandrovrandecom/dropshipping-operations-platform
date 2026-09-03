# Database Security

Tenant isolation is enforced in the database, not in application code. Row level
security plus composite foreign keys are the wall; the client is never trusted.

**Status**: identity, launch-workspace, username-reservation and account-deletion slices enforced. Table-by-table policy
and grant inventories live in `docs/database/architecture.md` and are updated
with every migration.

## Quick path

1. New table? Enable RLS in the same migration, before any grant.
2. New function? Follow the `SECURITY DEFINER` checklist below.
3. New key? Keep it server-side and record it in the ownership table.

## Threat boundaries

| Boundary | Expected behavior |
|---|---|
| Anonymous request | No rows readable; writes rejected. |
| Expired JWT | Table reads and writes are denied; the RPC is rejected with HTTP 401. |
| Signature-tampered JWT | Same; the test token's `exp` is still valid, isolating signature verification. |
| Membership removed | The same session's **next** request loses that team, without a global sign-out. |
| Authenticated non-member | Another team's rows are invisible and unwritable. |
| Forged `team_id` in payload | Rejected by policy; payload filters, never authorizes. |
| Browser bundle | Contains no privileged key. |
| Repository | Contains no real secret value. |
| Stolen, replayed or expired invitation | Rejected with one uniform message; the team is unchanged. |
| Unconfigured mail provider | The send fails loudly; no invitation is issued and no delivery is claimed. |
| Guessed or forged launch id | Answered exactly like another tenant's real id: `42501` with identical text, so nothing is disclosed. |
| Direct write to a launch status, snapshot or event | Refused: no insert or update grant exists on those columns or tables. |
| Attempt to purge one launch, snapshot or event | Refused: no launch table grants `delete` to anyone. |
| Cross-team template application | Refused with `22023`; the launch stays snapshot-free. |
| Retried launch creation after a lost response | Answered with the caller's own launch: the caller-supplied id is the idempotency key, so no duplicate launch and no second `created` event appear. A retry naming another team's or another member's id is refused with the same opaque `42501`. |
| Claim of a taken username, or a second claim by an account that already holds one | Both refused with one identical `22023` message. Availability and account state are protected facts; only the format rule — which the caller can compute unaided — gets a distinct message. |
| Concurrent claims of the same username | Exactly one winner. A single `insert ... on conflict do nothing` decides it, so no branch can observe, or leak, which constraint refused the loser. |
| Any protected write by a confirmed account holding no claim | Denied with `42501` and no side effects, on all ten gated tables. The claim itself is the only door the gate leaves open. |
| Direct read, write or enumeration of `username_reservations` | Refused at the privilege layer: forced RLS, no policy, and no grant of any kind to any client role. |
| Resolution of a user outside the caller's teams | Answered with an empty set, identically to a team with no claims and to a team that does not exist — never a refusal, so it is no existence oracle. |
| Account or profile deletion | The reservation survives, and it holds no email or profile data — only the name, the subject id and the claim instant. |
| Any caller reaching a privileged deletion entry point | `claim_account_deletion`, `finalize_account_deletion` and `account_deletion_status` are granted to `service_role` alone. `anon`, `authenticated` and the subject itself are refused identically with `42501`, before the body runs — a caller that reached the body and got `22023` would learn its own receipt's state. |
| Unbounded privileged retry | Three executions per receipt, counted by the claim alone. The fourth returns the frozen `failed`, and an exhausted receipt can never be finalized again. |
| A request naming another account | Structurally impossible: the RPC names no target and writes the caller's own receipt only. |
| A request naming an unowned or absent team | One identical `42501` for both, decided by a single ownership check rather than a foreign key, so the pair is no cross-tenant existence oracle. |
| Direct read, write or enumeration of a receipt, a selection or a transfer offer | Refused at the privilege layer: forced RLS, no policy, and no grant of any kind to any client role. |
| Retained history after deletion | `created_by` and `actor_user_id` go null; the facts and the append order stay readable to the team, and no deleted email or display name survives anywhere. |
| Session issued before final deletion | Denied afterwards without restoring identity or tenant associations; a same-email signup is an unrelated UUID. |
| Receipt retention failing | The purge runs inside a block that discards every error, so a failed cleanup leaves the receipt and never aborts the finalizer. The MAY cannot regress a MUST. |

## Key handling

| Key | Where it may live | Rotation owner |
|---|---|---|
| Anon / publishable key | Client and `.env.example` placeholder | _pending_ |
| `service_role` / secret key | Server runtime secret store only | _pending_ |

Real `.env*` files are git-ignored. `pnpm db:smoke` fails if a privileged key
value appears in tracked files or in a `NEXT_PUBLIC_*` variable.

## Least privilege

- Grants are explicit per table and per operation; no blanket `GRANT ALL`.
- `auto_expose_new_tables = false` keeps new objects unreachable by default.
- Default privileges differ by creator. Migrations run as `postgres`, whose
  `public` default ACL gives `anon`/`authenticated`/`service_role` only
  `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` — no data access. But `supabase_admin`'s
  default ACL still grants `ALL`, so a table created through Studio ships
  world-readable. That is a second reason schema changes must be migrations.
- Migrations still `revoke` explicitly before granting, so a table stays closed
  even if those defaults change. `anon` holds no privilege on any table today.
- `service_role` also has no data privileges here; server-side code that needs
  them must be granted them explicitly and deliberately.
- Prefer column grants over table grants. A column the client must never set —
  such as `teams.owner_user_id` — is simply never granted, so forgery fails at
  the privilege layer before RLS is even consulted.

## Invitation delivery

Delivery is a port, not a vendor: `supabase/functions/send-invitation/delivery.ts` defines it,
and the Edge Function forwards the caller's JWT so the database still decides who may invite.
Local and test environments resolve the capture adapter, which records the message instead of
sending it. Every other environment must be configured explicitly — an unconfigured one raises
`DeliveryNotConfigured`, and the function answers `503` with `delivered: false` **before** an
invitation is created, so it never claims a send. The database stores only `sha256(token)`.

**Deferred production setup.** The preferred provider is Resend, adopted only after a custom
sending domain is verified: Resend's onboarding domain delivers exclusively to the account
owner's own address, so it is test-only. Production readiness requires domain verification,
SPF, DKIM and DMARC records, provider secrets in a server-side secret store, and evidence of a
real delivery. No Resend dependency or credential exists in this repository today.

## Session validity

A session is valid only while its JWT verifies and has not expired; **authorization is a separate
question, re-answered from live database state on every request.** No session table, no cached role.

| Question | Where it is answered |
|---|---|
| Is this caller authenticated? | JWT signature and `exp`, verified before the request reaches RLS. |
| May this caller touch this team? | `is_team_member` / `is_team_owner`, evaluated per statement. |

Two consequences follow, and both are proven, not assumed:

- **Removal is immediate and team-local.** Deleting a membership takes effect on that session's next
  request, because the policy re-reads `memberships`. It revokes nothing else: the same session keeps
  every other team it still belongs to.
- **A confirmed email change moves invitation identity with the account.** `profiles.email` is
  mirrored from `auth.users.email` (see `docs/database/architecture.md`), and `profiles.email` is
  never client-writable — `authenticated` holds `update (display_name)` only.

**Deferred, and deliberately not implemented here.** Forced session revocation and a revocation
policy; account recovery pages and emails; device, current-device and all-device sign-out;
remembered-login UX; any new identity API or combined "who am I" read contract; login rate limiting
or lockout beyond Supabase defaults; production email-provider setup. Define each before building it.

## `SECURITY DEFINER` checklist

- [x] `SET search_path = ''`
- [x] All references schema-qualified
- [x] `REVOKE EXECUTE ... FROM PUBLIC`
- [x] Explicit `GRANT EXECUTE` to the intended role only

## Enforced denials

`tests/isolation/rls.test.ts` proves each boundary against the live local stack:
anonymous read/write; a correctly signed but expired token and an unexpired token with a forged
signature, both denied on read and write, with their RPC calls specifically rejected by PostgREST
at HTTP 401. The RPC control sends the same unknown invitation token through a valid session and
reaches the function's distinct HTTP 400 / SQLSTATE `22023` rejection. The suite also proves the
two-team removal cutoff; outsider reads and writes; forged `owner_user_id`; a membership written
into an unowned team; and a plain member attempting owner governance.
`tests/identity/invitations.test.ts` adds the
invitation boundary: non-owner and cross-team issuing, expired, reused, wrong-recipient,
unauthenticated and tampered acceptance, and confirmed-email synchronization — a pending request
stays inert, another account's profile is untouched, and the previous address stops matching.

`tests/isolation/launch-rls.test.ts` proves the launch boundary across all six launch tables at
once, because a boundary that holds for `launches` but leaks through `launch_checklist_items` is
not a boundary: anonymous reads and RPC calls, cross-team reads and updates, templates and items
planted into another team, a forged tenant key on an item pointing at a foreign template, direct
writes to launches, snapshots, snapshot items and events, the absence of any delete path for both
a member and the team owner, the ungrantable `is_default` column, and the identical `42501`
answer for an unknown id and another team's id across all five RPCs.
`tests/database/launch-{lifecycle,templates,history,retention}.test.ts` prove the behavior those
denials protect, including that whole-team deletion is the only destructive path and that a
non-owner's attempt leaves every launch, template, snapshot and event in place.

`tests/identity/username-reservation.test.ts` proves the registry contract: format and
normalization, one claim per account, the concurrent winner, the identical refusal for a taken name
and a repeat claim, survival of account deletion with no PII retained, and denial of every direct
registry read. `tests/isolation/username-gate.test.ts` proves the gate across all ten gated tables
and twenty-one operations — each denial asserted as `42501` **and** the gate's own message, so an
RLS or grant refusal carrying the same code can never be mistaken for a gate hit — plus the
refused → claim → allowed sequence, the null-`auth.uid()` no-op, and both resolver scopes.
`tests/database/identity-module.test.ts` pins the typed wrappers and the module's layering.

**Rollback is forward-only here.** Closing the launch surface means shipping a *new* migration that
revokes the six table grants and the five `execute` privileges — never editing the applied file and
never dropping the tables, which hold user data. `tests/database/reproducibility.test.ts` executes
that exact revoke inside a block that always aborts, so the rollback path is proven and undone in
the same statement.

The same file proves both username rollbacks the same way. The gate's is **symmetric** — drop the
ten triggers, revoke the resolver, and the schema is exactly pre-gate. The registry's is
**deliberately not**: it revokes `execute` on `claim_username(text)` and leaves the table standing,
because a permanent name must outlive the account that claimed it. Both assertions fail if the
rollback path removes the registry.

**Gotcha.** `has_username()` is granted to nobody. It is the gate's own question, and an exposed
predicate would be exactly the reservation-status oracle that the closed registry exists to prevent.

**The typed API wraps only what the database grants `authenticated`.** That is
`claimUsername`, `resolveTeamUsernames`, `offerTeam`, `acceptTeam` and
`requestAccountDeletion`. The three `service_role` deletion functions are deliberately absent from
`src/`: an application wrapper around the status read would be an oracle over another account's
deletion, and one around the claim or the finalizer would move the admission point out of the
database. `tests/database/identity-module.test.ts` asserts that absence across `src/modules/`, and
that the string `service_role` appears in no source file at all — grants live in SQL alone.

`tests/database/account-deletion-finalization.test.ts`,
`tests/identity/account-deletion.test.ts` and `tests/isolation/account-deletion-rls.test.ts` prove
the deletion boundary: the four caller kinds refused at all three privileged entry points, the
bounded retry and its refused fourth claim, both invitation revocation scopes, the ordered halt on
an injected fault, the terminal-only and age-bounded purge, and an injected cleanup failure that
leaves the run `done`.

**Gotcha.** `insert ... returning` evaluates the `select` policy before
after-insert triggers run. A read policy that depends on a row written by such a
trigger must also admit the creator directly, or the writer cannot read back the
row it just created.

**Gotcha.** `postgres` holds `BYPASSRLS`, so a `security definer` function owned by it writes
past even `force row level security`. That is exactly why the RPCs are the controlled write
path — and why `team_invitations` deliberately has no insert or update policy: with RLS on
and no permissive policy, a direct client write is denied by default rather than by a rule
somebody could later widen.

## Environments and audit

Local development uses local CLI credentials only. Production changes ship as
reviewed migrations; dashboard schema edits are drift and are not permitted.
Incident and audit ownership is recorded at the pre-launch gate.
