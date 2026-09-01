# Account Deletion Lifecycle Specification

## Purpose

Definitive deletion.

## Requirements

### Requirement: Definitive request and team resolution

Accounts MUST request only their own deletion. Scheduling MUST require every owned team to be transferred to a member or selected for deletion; pending transfer is unresolved. Live teams MUST retain owners. Acceptance MUST enter `pending`, without grace, cancellation, recovery, or restoration.

#### Scenario: Teams resolved

- GIVEN every owned team is transferred or selected for deletion
- WHEN its owner requests deletion
- THEN the request MUST enter `pending`

#### Scenario: Resolution is partial

- GIVEN an owned team is live or has a pending transfer
- WHEN scheduling is requested
- THEN denial MUST preserve ownership

#### Scenario: Another account targeted

- GIVEN an account targets another identity for deletion
- WHEN it submits the request
- THEN denial MUST preserve and hide the target

### Requirement: Isolated ownership transfer

Only current owners MUST request transfer to another current member of that team. Only the intended recipient MAY accept. Acceptance MUST avoid an ownerless interval. Requests MUST expire after seven days.

#### Scenario: Intended acceptance

- GIVEN the intended member has an unexpired request
- WHEN they accept
- THEN ownership MUST move without an ownerless interval

#### Scenario: Invalid acceptance

- GIVEN a request expired or its caller is outside-team or unintended
- WHEN acceptance occurs
- THEN denial MUST preserve ownership and hide transfer state

### Requirement: Privileged observable finalization

Finalization MUST require privileged invocation, not automatic scheduling. Authorized administrators MUST observe `pending`, `in-progress`, `done`, or `failed`. Failure MUST preserve completed steps and allow continuation. Finalization after `done` MUST be idempotent.

#### Scenario: Finalization succeeds

- GIVEN a privileged finalizer and `pending` request
- WHEN finalization completes
- THEN state MUST progress through `in-progress` to `done`

#### Scenario: Partial failure is retried

- GIVEN completed steps and a `failed` request
- WHEN a privileged finalizer retries
- THEN completed effects MUST remain and unfinished work MUST continue safely

#### Scenario: Finalization is unauthorized

- GIVEN an unprivileged caller
- WHEN it finalizes or reads state
- THEN denial MUST hide deletion and tenant state

#### Scenario: No invocation occurs

- GIVEN a request is `pending`
- WHEN no privileged invocation occurs
- THEN it MUST remain pending without timing guarantees

#### Scenario: Done request is retried

- GIVEN a request is `done`
- WHEN finalization repeats
- THEN it MUST return completion without restoring data

### Requirement: Final outcome

Before `done`, finalization MUST delete selected teams; cancel invitations issued by or addressed to the account; and delete authentication identity, email, and `display_name`. Permanent username reservation MUST survive alone. Historical creator/actor references MAY become null while authorized tenants retain facts and order. Same-email signup MUST create an unrelated UUID without restored associations. Receipts MUST contain no PII. Later finalizations MAY purge expiry-eligible receipts best-effort, without fixed retention or purge timing.

#### Scenario: Identity and both invitation scopes are removed

- GIVEN account PII and both invitation scopes
- WHEN finalization reaches `done`
- THEN identity, PII, and both scopes MUST be absent
- AND the username MUST remain reserved

#### Scenario: Selected team is deleted

- GIVEN a team selected for deletion
- WHEN finalization completes
- THEN the team MUST be deleted before its owner identity

#### Scenario: Historical attribution is cleared

- GIVEN history references the account
- WHEN finalization nulls it
- THEN facts and order MUST remain tenant-queryable

#### Scenario: Former email signs up again

- GIVEN deletion is `done`
- WHEN the former email signs up
- THEN a new UUID MUST restore no teams, history, or configuration
- AND the former username MUST remain unavailable

#### Scenario: Receipt is privacy-safe and lazily purged

- GIVEN a non-PII receipt is expiry-eligible
- WHEN later finalizations occur or do not occur
- THEN it MAY be purged without a fixed retention or purge-time guarantee
