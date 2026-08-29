# Tasks: Identity Session Contracts

## Review Workload Forecast

| Field | Value |
|---|---|
| Exact chained review total | 1,142 changed lines across four PRs |
| 400-line budget risk | Resolved by four PRs, each below the 400-line maximum |
| Chained PRs | Required |
| Delivery strategy | chained PRs |
| Chain strategy | `stacked-to-main` |
| Size exception | None; no `size:exception` is approved |

Decision needed before delivery: No — the maintainer resolved delivery to chained PRs.
All four PRs target `main` and merge strictly in order.

### Delivery Slices

| Order | Logical slice | Exact changed lines | Target | Merge dependency |
|---:|---|---:|---|---|
| 1 | OpenSpec bootstrap + exploration + proposal | 308 | `main` | None |
| 2 | Durable baseline spec + archived delta spec, design, and tasks | 313 | `main` | PR 1 merged |
| 3 | Implementation + completed task-checkbox delta | 207 | `main` | PR 2 merged |
| 4 | Apply, verification, and archive evidence | 314 | `main` | PR 3 merged |

## Phase 1: RED Contract Tests

- [ ] 1.1 RED: In `tests/identity/invitations.test.ts`, add failing proofs for confirmed profile sync, pending `email_change` inertness, account-local sync, new-email acceptance, and old-email uniform denial/no membership.
- [ ] 1.2 RED: In `tests/database/reproducibility.test.ts`, expect `handle_user_email_change: secdef=true config=search_path="" acl=postgres=X/postgres` and eight definer bodies; run Unit 1 focused command and record failure evidence.
- [ ] 1.3 RED: Preserve the existing anonymous read/mutation denial in `tests/isolation/rls.test.ts`; add failing expired-token mutation/`accept_invitation` RPC and valid-expiry, invalid-signature read/mutation denial proofs with no tenant data.
- [ ] 1.4 APPROVAL/CHARACTERIZATION: Refactor/add a two-team same-session removal proof in `tests/isolation/rls.test.ts`: characterize the pre-existing live-RLS behavior where the next read and mutation fail for the removed team while the other team remains authorized; record its passing approval evidence.

## Phase 2: Green Database and Test Support

- [ ] 2.1 Create `supabase/migrations/20260829120000_profile_email_sync.sql`: `AFTER UPDATE OF email ON auth.users` trigger calls a schema-qualified `security definer` function (`search_path = ''`) that updates only `public.profiles` where `user_id = new.id`; use changed-email `WHEN`, revoke public/client execution, preserve RLS/grants, and create no profile.
- [ ] 2.2 In `tests/support/local-stack.ts`, factor signed JWT minting and add `tamperedToken(userId)` with valid `exp` and wrong HMAC; make the RED session-denial proofs executable.
- [ ] 2.3 Run both focused commands; record exit 0 and every required scenario passing, including confirmed-only/account-local sync, invitation matching, invalid-session denial, and team-local cutoff.

## Phase 3: Reproducibility and Documentation

- [ ] 3.1 Update `docs/database/architecture.md` with the trigger/function inventory, migration ledger entry, and confirmed-email ERD label; document forward rollback as dropping only trigger/function.
- [ ] 3.2 Update `docs/security/database-security.md` with anonymous, expired, tampered-signature, and live-membership removal denials; explicitly exclude revocation, recovery, APIs, rate limits, and email-provider work.
- [ ] 3.3 Run `pnpm test` and record exit 0; run `pnpm db:smoke --require-runtime` and record runtime-required smoke success. Verify the forward rollback affects no profile values, RLS, grants, or session state.
