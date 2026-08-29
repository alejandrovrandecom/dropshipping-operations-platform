# Database Security

Tenant isolation is enforced in the database, not in application code. Row level
security plus composite foreign keys are the wall; the client is never trusted.

**Status**: identity slice enforced. Table-by-table policy and grant inventories
live in `docs/database/architecture.md` and are updated with every migration.

## Quick path

1. New table? Enable RLS in the same migration, before any grant.
2. New function? Follow the `SECURITY DEFINER` checklist below.
3. New key? Keep it server-side and record it in the ownership table.

## Threat boundaries

| Boundary | Expected behavior |
|---|---|
| Anonymous request | No rows readable; writes rejected. |
| Authenticated non-member | Another team's rows are invisible and unwritable. |
| Forged `team_id` in payload | Rejected by policy; payload filters, never authorizes. |
| Browser bundle | Contains no privileged key. |
| Repository | Contains no real secret value. |
| Stolen, replayed or expired invitation | Rejected with one uniform message; the team is unchanged. |
| Unconfigured mail provider | The send fails loudly; no invitation is issued and no delivery is claimed. |

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

## `SECURITY DEFINER` checklist

- [x] `SET search_path = ''`
- [x] All references schema-qualified
- [x] `REVOKE EXECUTE ... FROM PUBLIC`
- [x] Explicit `GRANT EXECUTE` to the intended role only

## Enforced denials

`tests/isolation/rls.test.ts` proves each boundary against the live local stack:
anonymous read/write, a correctly signed but expired token, outsider reads and
writes, forged `owner_user_id`, a membership written into an unowned team, and a
plain member attempting owner governance. `tests/identity/invitations.test.ts` adds the
invitation boundary: non-owner and cross-team issuing, and expired, reused, wrong-recipient,
unauthenticated and tampered acceptance.

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
