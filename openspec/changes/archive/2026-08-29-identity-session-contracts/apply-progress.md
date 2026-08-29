# Apply Progress: Identity Session Contracts

**Mode**: Strict TDD (`strict_tdd: true`, Vitest 3.2.7)
**Batch**: 1 of 1 — all 10 tasks complete. No previous apply-progress existed.
**Delivery state**: PRs #12 (308), #14 (313), and #16 (222) are merged; #16 merged at `215b2d39152b804022616f2e1178a1c6d178d0e2`. Only PR4 evidence delivery remains.
**Delivery**: chained PRs, `chain_strategy: stacked-to-main`, no `size:exception`, 400-line maximum per PR.

## Quick path

1. Read `supabase/migrations/20260829120000_profile_email_sync.sql` — the whole behavior change.
2. Read the RED-first proofs it satisfies in `tests/identity/invitations.test.ts`.
3. Confirm the evidence tables below.

## Completed tasks

All of 1.1–1.4, 2.1–2.3, 3.1–3.3 are marked `[x]` in `tasks.md`.

## Files changed

| File | Action | What was done |
|---|---|---|
| `supabase/migrations/20260829120000_profile_email_sync.sql` | Created | `handle_user_email_change()` (`security definer`, `search_path = ''`, execute revoked) plus `on_auth_user_email_changed`, an `after update of email on auth.users` trigger guarded by `when (new.email is distinct from old.email)`. |
| `tests/support/local-stack.ts` | Modified | Factored JWT minting into `mintToken(userId, expiresInSeconds, secret)`; `expiredToken` now delegates to it (claims byte-identical), and new `tamperedToken` mints a valid-`exp` token signed with the wrong secret. |
| `tests/identity/invitations.test.ts` | Modified | New `confirmed email synchronization` suite: confirmed-only sync, pending `email_change` inertness, account-local sync, new-address acceptance, previous-address uniform denial with no membership. |
| `tests/isolation/rls.test.ts` | Modified | Expired-token case extended to mutation + RPC; new invalid-signature denial; new `membership removal` two-team cutoff suite. |
| `tests/database/reproducibility.test.ts` | Modified | Added the `handle_user_email_change` inventory row in alphabetical position; definer-body count 7 → 8. |
| `docs/database/architecture.md` | Modified | Function/trigger row, migration ledger row with the forward-rollback note, ERD label, and the confirmed-only rationale. |
| `docs/security/database-security.md` | Modified | Expired / tampered / removal threat rows, a new **Session validity** section with explicit deferrals, and an expanded enforced-denials paragraph. |

Unchanged as designed: `src/lib/database.types.ts` (trigger functions are absent from generated
types — proven by the reproducibility suite, which regenerates and diffs).

## TDD cycle evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/identity/invitations.test.ts` | Integration | ✅ 29/29 | ✅ 2 failures: profile kept old address; stale invitation was accepted (`denied.error` undefined) | ✅ Passed after 2.1 | ✅ 5 scenarios (confirmed / pending / account-local / new-address match / previous-address denial) | ➖ None needed |
| 1.2 | `tests/database/reproducibility.test.ts` | Integration | ✅ 29/29 | ✅ 2 failures: inventory row missing; bodies 7 ≠ 8 | ✅ Passed after 2.1 | ➖ Single inventory contract | ➖ None needed |
| 1.3 | `tests/isolation/rls.test.ts` | Integration | ✅ 29/29 | ✅ `TypeError: (0 , tamperedToken) is not a function` | ✅ Passed after 2.2 | ✅ 2 code paths (expired vs. valid-`exp` bad signature) × read/mutate/RPC | ➖ None needed |
| 1.4 | `tests/isolation/rls.test.ts` | Integration | ✅ 29/29 | ⚠️ **Approval test, not RED** — see honesty note | ✅ Passed | ✅ 2 teams (removed vs. retained) | ➖ None needed |
| 2.1 | migration | Integration | N/A (new file) | Driven by 1.1/1.2 | ✅ Passed | Covered by 1.1 | ✅ Body prose moved to header — see gotcha |
| 2.2 | `tests/support/local-stack.ts` | Integration | ✅ 29/29 | Driven by 1.3 | ✅ Passed | Covered by 1.3 | ✅ Extracted `mintToken`, named `TOKEN_LIFETIME_SECONDS` |

**Honesty note on 1.4.** Team-local removal cutoff is already enforced by live RLS, so this proof
passed the moment it was written. Calling it RED would be false. Per the strict-TDD module it is an
**approval test**: it pins behavior the spec now formalizes so a future policy change cannot silently
revoke it. The file as a whole was red at that point (missing `tamperedToken`), but that failure
belongs to 1.3. Tasks 1.1–1.3 were genuinely red-first against executed evidence.

## Work unit evidence

| Evidence | Unit 1 — confirmed-email sync and invitation identity | Unit 2 — live-session and team-local RLS proofs |
|---|---|---|
| Focused command | `pnpm vitest run tests/identity/invitations.test.ts tests/database/reproducibility.test.ts` | `pnpm vitest run tests/isolation/rls.test.ts` |
| Result | **2 files passed, 20/20 tests**, exit 0 | **1 file passed, 11/11 tests**, exit 0 |
| Runtime harness | `pnpm db:smoke --require-runtime` → `SMOKE OK (static + rebuild)`, exit 0; migration ledger lists `20260829120000` | Same run — both units share the one local stack |
| Rollback boundary | Delete the migration file, the `confirmed email synchronization` suite, its two helpers, the reproducibility row, and the two docs edits | Delete `tamperedToken`/`mintToken` (restore the inline `expiredToken`), the two rls.test.ts additions, and the security-doc session section |

Both units are independently revertible; neither removes any pre-existing behavior.

## Verification results

| Check | Command | Result |
|---|---|---|
| Safety net (pre-change) | `pnpm test` | 4 files, **29/29 passed** |
| Full suite (post-change) | `pnpm test` | 4 files, **33/33 passed**, exit 0 |
| Runtime smoke | `pnpm db:smoke --require-runtime` | **SMOKE OK (static + rebuild)**, exit 0 |
| Schema linter | inside reproducibility suite | `No schema errors found` |
| Generated types | inside reproducibility suite | committed types identical to regenerated schema |

### Forward-rollback verification (task 3.3)

Executed against the live database: dropped only `on_auth_user_email_changed` and
`public.handle_user_email_change()`, then compared before/after state. All seven checks returned
`true` — profile values unchanged, RLS `enabled`/`forced` flags and table ACLs unchanged, policy
count unchanged, trigger and function gone, the other 7 `public` functions intact, and no session
table exists to unwind. The database was then restored with `supabase db reset`.

## Deviations from design

None in behavior. One **implementation-level correction inside** the designed migration: the design's
sketch put normalization rationale in the function body, which failed the reproducibility guard (see
gotcha). The rationale moved to the migration header; the SQL contract is exactly as designed.

## Issues found

**Gotcha — English prose inside a `security definer` body breaks the schema-qualifier guard.**
`reproducibility.test.ts` scans every `prosrc` with
`/\b(?:from|join|insert\s+into|update)\s+(?!set\b)([a-z_][\w.]*)/gi` and requires a `.` in each hit.
A comment reading "diverge **from the** insert path" matched, and the suite demanded that `the` be
schema-qualified. The guard is correct and was left untouched; explanatory prose now lives above the
`create function`, outside `prosrc`. Worth knowing before the next definer function is written — the
migration itself carries a note saying so.

## Remaining tasks

None. All 10 tasks in `tasks.md` are `[x]`.

## Workload / PR boundary

| Order | Logical slice | Exact changed lines | Target | Merge dependency |
|---:|---|---:|---|---|
| 1 | OpenSpec bootstrap + exploration + proposal | 308 | `main` | Merged as PR #12 |
| 2 | Durable baseline spec + archived delta spec, design, and tasks | 313 | `main` | Merged as PR #14 |
| 3 | Implementation + completed task-checkbox delta | 222 | `main` | Merged as PR #16 at `215b2d39152b804022616f2e1178a1c6d178d0e2` |
| 4 | Apply, verification, and archive evidence | 321 | `main` | PR #16 merged; PR4 remains |

The implementation portion is 202 review lines; ten completed checkbox replacements contribute 20 review lines, so PR3 totals 222. PR4 is exactly 321 review lines: 315 additions from the three untracked reports plus six review lines from three existing-line replacements (one in `proposal.md`, two in `tasks.md`). The four-PR total is 1,164; PRs #12, #14, and #16 are merged, and only PR4 evidence delivery remains.

## Next step

Deliver PR4 evidence only; do not rerun runtime verification for this metadata correction.
