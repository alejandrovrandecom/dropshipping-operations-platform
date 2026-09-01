# Tasks: Launch Workspace Core

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,150 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 database contract → PR2 module → PR3 downstream evidence |
| Delivery strategy | exception-ok |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

PR1 `size:exception` only waives lines; strict TDD/gates remain.
PR1 ships complete database behavior.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Complete database contract/docs | PR1 → main; approved exception | `pnpm test -- tests/database/launch-*.test.ts tests/isolation/launch-rls.test.ts tests/database/reproducibility.test.ts` | `pnpm db:smoke --require-runtime` | Later forward migration revokes six-table grants/five-RPC execute; `supabase/migrations/20260829170000_launch_workspace_core.sql` stays immutable. |
| 2 | Launch module | PR2 → main after PR1, ≤400 | `pnpm test -- tests/database/launch-module.test.ts` | `pnpm db:setup && pnpm test -- tests/database/launch-module.test.ts` | Remove only `src/modules/launch/` and its test. |
| 3 | Downstream delivery evidence | PR3 → main after PR2, ≤400; not an apply task | `pnpm test` | `pnpm db:smoke --require-runtime` | Only `openspec/changes/launch-workspace-core/{apply-progress.md,verify-report.md,archive-report.md}`; no product files. |

## Phase 1: PR1 RED Database Contract (complete before any PR1 GREEN)

- [x] 1.1 RED-create `tests/database/launch-{lifecycle,retention}.test.ts` for 18 lifecycle/retention scenarios: creation, transitions, eligibility, recovery, purge, owner/non-owner deletion, and the two R4-001 idempotency/authorization additions.
- [x] 1.2 RED-create `tests/database/launch-templates.test.ts` for 16 template/default/snapshot/retention scenarios incl. direct-create/cross-team denials.
- [x] 1.3 RED-create `tests/database/launch-history.test.ts` for 15 event facts, append order, continuity, retention, and team deletion.
- [x] 1.4 RED-create `tests/isolation/launch-rls.test.ts` for six-table isolation: forged IDs, cross-team reads/writes, direct snapshot/event writes, no DELETE, and opaque `42501`.
- [x] 1.5 RED-extend `tests/database/reproducibility.test.ts` with `INVENTORY`: exactly six tables and two enums; constraints, RLS, grants, RPC ACLs/search paths, types, reset, and forward revoke.

## Phase 2: PR1 GREEN/REFACTOR Database Contract

- [x] 2.1 GREEN-create forward-only `supabase/migrations/20260829170000_launch_workspace_core.sql` with exactly six tables and two enums; tenant FKs, checks/indexes, and `profiles` `RESTRICT`.
- [x] 2.2 GREEN forced RLS, member predicates, revoke-then-column grants, and no DELETE policy/grant across all six tables.
- [x] 2.3 GREEN `create_launch`, `transition_launch`, `restore_launch`, `apply_checklist_template`, and `set_default_checklist_template`; enforce lock order, atomic events, eligibility, `23505`/`22023`/`23514`, and opaque `42501`.
- [x] 2.4 GREEN PR1 RED tests; regenerate `src/lib/database.types.ts` using `pnpm -s db:types > src/lib/database.types.ts`; update `docs/database/{architecture,operations}.md` and `docs/security/database-security.md` for forward-only rollback.
- [x] 2.5 REFACTOR fixtures and SQL without changing the complete `INVENTORY`; run `pnpm test` serially and `pnpm db:smoke --require-runtime`.

## Phase 3: PR2 RED/GREEN/REFACTOR Module

- [x] 3.1 RED-create `tests/database/launch-module.test.ts` for service contracts, RPC/list/history order, generated projections, and repository-only `.from()`/`.rpc()` access.
- [x] 3.2 GREEN-create `src/modules/launch/{types,repository,service}.ts`; preserve inward dependency direction and leave the migration immutable.
- [x] 3.3 REFACTOR names/types; rerun the focused command, retain ≤400 lines, and keep account/profile lifecycle scope out.

## Downstream Delivery Guidance (non-checkbox)

`sdd-apply` ends after all PR1/PR2 implementation checkboxes are complete. Query native status, then follow its exact route through required review → independent `sdd-verify` → `sdd-archive`; never hardcode or directly skip review. PR3 evidence is downstream-only.
