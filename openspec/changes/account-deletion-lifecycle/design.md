# Design: Account Deletion Lifecycle

## Technical Approach

Deletion is a database contract, not a service. Probed: `postgres` holds `BYPASSRLS` and `ar*wdDxtm` on `auth.users`, so a definer function deletes the identity in SQL — no Admin API, no `pg_cron`. A live owned team refuses it with `23503`.

## Architecture Decisions

| Decision | Choice over the alternative | Rationale |
|---|---|---|
| Privileged surface | `service_role` execute-only, plus in-SQL `delete from auth.users` | No data privilege; an authenticated reader would be an oracle. |
| Durable `in_progress` | `claim` commits it, `finalize` works | One RPC cannot expose an intermediate state. |
| Step isolation | Per-step `begin/exception` blocks | Step `k` fails, steps `1..k-1` stand, state records `failed`. |
| Attempt bound, **confirmed by the maintainer** | `attempts` on the receipt, incremented by `claim` alone: **3 executions total — 1 initial plus 2 retries** | Resolved, not assumed. One admission point bounds every run; an integer keeps the receipt non-PII. |
| Exhausted bound | The **fourth** claim is refused, returning the standing `failed` | A distinguishable refusal is an oracle; `finalize` also rejects anything not `in_progress`, so the request awaits operational intervention. |
| Selected teams | Recorded at request, deleted at finalization | Team precedes identity; selections cascade off `teams`, so retry is a no-op. |
| Receipt | `account_deletion_requests`, **no** FK | Any referential action destroys what must outlive the account. |
| Shipped, PR2a/PR2b | Re-offer supersedes, acceptance re-checks membership, a pending offer blocks; `*_require_username` trigger per new table | Expired rows must not block re-offers; a removed member must not inherit; definer RPCs bypass RLS. Inventory 10 → 12. |
| Typed API | Only `authenticated` RPCs reach `src/` | Wrapping the finalizer pulls `service_role` into `src/`. |

## Data Flow

    request ──→ requests(pending, attempts=0) + selections
    claim   ──→ in_progress, attempts+1   ── 4th claim refused ──→ frozen failed
    finalize ─→ teams → invitations → auth.users ──→ done | failed

## File Changes

Two new migrations after `…120000_…requests` (`6c7befa`):

- `20260902130000_account_deletion_claim_ledger.sql` — `attempts` column, `account_deletion_status`, bounded `claim_account_deletion`, their `service_role` grants.
- `20260902140000_account_deletion_finalization.sql` — `finalize_account_deletion` (condemned teams, both revocation scopes, auth identity, lazy purge) and its grant.

Also the isolation file, `tests/database/{account-deletion-finalization,reproducibility}.test.ts`, `src/lib/database.types.ts`; PR4 adds `src/modules/identity/{types,repository,service}.ts` (3-file shape) and `docs/{database/architecture,database/operations,security/database-security}.md`.

## Interfaces / Contracts

`claim_account_deletion`, `finalize_account_deletion` and `account_deletion_status` each take `p_user_id uuid`, return `account_deletion_state`, granted to `service_role` alone; the bound lives in `claim`'s body. The three `authenticated` RPCs are unchanged. Revocation: `delete` where `accepted_at is null and (invited_by = target or email = <profile email>)`, before the profile goes.

## Testing Strategy

Serial Vitest, privileged RPCs via `sql()`; gate tests MUST pass `signIn(email, false)`.

- **Integration** — gating, expiry, supersede, membership recheck, attempt bound, retry continuation, idempotency, both revocation scopes, PII removal, username survival, deleted session, re-signup, lazy purge, no scheduler.
- **Isolation, reproducibility** — unprivileged claim/finalize/status and cross-tenant denial, uniform `42501` by code **and** message; inventories, trigger count, forward-revoke.

## Threat Matrix

Git, shell, subprocess, file-classification, PR boundaries: **N/A**.

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Privileged entry point | `service_role` only | Every other role refused identically. | all four caller kinds denied on each slice's entry points |
| Unbounded privileged retry | `failed` is re-claimable | 3 executions (1 + 2 retries), then frozen. | a `failed` receipt claimed three times, refused the fourth, then unfinalizable |

## Migration / Rollout

Forward-only, **six** `stacked-to-main` slices, each on the previous one's base and independently green there under focused tests, `pnpm test`, and `pnpm db:smoke --require-runtime`.

| Slice | Deliverable behavior | Authored |
|---|---|---|
| PR1 ✅ | FK relaxation, history | 394 |
| PR2a ✅ | transfers | shipped |
| PR2b ✅ | requests, gating | `6c7befa` |
| PR3a | observable state, bounded claim | ~250 |
| PR3b | the finalizer, lazy purge | ~240 |
| PR4 | typed API, docs, ledger | ≤400 |

**PR3a owns the bound**: column, increment and refusal all sit in `claim`; PR3b writes `done`/`failed` alone. Neither waits on the other: PR3a's bound test seeds `failed` through `sql()`; PR3b proves a genuine partial failure continues on the next claim-then-finalize pair. The uncommitted 399-line PR3 is re-carved: `status` and `claim` move to PR3a and gain the bound, `finalize` moves to PR3b unchanged.

Rollback, each removable alone. **PR3a**: drop `…claim_ledger.sql` and the isolation file, revert the additive hunks in both `tests/database/` files. **PR3b**: drop `…finalization.sql` and its hunks in those three files. Both regenerate types and revoke `execute` only: never drop `account_deletion_requests`, never re-tighten a relaxed FK once a row holds a null actor.

## Open Questions

- [ ] (non-blocking) Operator reset for a frozen request — the deferred scheduler's concern.
- [ ] (non-blocking) Receipt expiry constant; the purge is best-effort.
