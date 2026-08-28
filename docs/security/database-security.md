# Database Security

Tenant isolation is enforced in the database, not in application code. Row level
security plus composite foreign keys are the wall; the client is never trusted.

**Status**: skeleton. Policy and function inventories fill in with each slice.

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

## `SECURITY DEFINER` checklist

- [ ] `SET search_path = ''`
- [ ] All references schema-qualified
- [ ] `REVOKE EXECUTE ... FROM PUBLIC`
- [ ] Explicit `GRANT EXECUTE` to the intended role only

## Environments and audit

Local development uses local CLI credentials only. Production changes ship as
reviewed migrations; dashboard schema edits are drift and are not permitted.
Incident and audit ownership is recorded at the pre-launch gate.
