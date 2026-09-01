# Launch Lifecycle Specification

## Purpose

Define isolated launch lifecycle, recovery, retention, and team-deletion boundaries.

## Requirements

### Requirement: Preparing launches

At the database boundary, authorization and tenant isolation MUST enforce member access only within their team. Members MUST create named team launches starting `preparing`; URL, notes, and snapshot MAY be absent. Empty names and cross-team operations MUST be denied.

Creation MUST be idempotent on a caller-supplied launch identifier. A repeated creation carrying an identifier the caller already created MUST return that same launch without creating a second launch or appending a second `created` event. A missing identifier MUST be rejected as invalid input. An identifier already held by another team or another creator MUST be denied exactly like any other cross-team operation.

#### Scenario: Creation

- GIVEN a team member
- WHEN creating a name-only launch
- THEN it MUST start `preparing`

#### Scenario: Missing name

- GIVEN a team member
- WHEN creation lacks a name
- THEN creation MUST be rejected

#### Scenario: Retry after a lost response

- GIVEN a member whose creation committed but whose response was lost
- WHEN they retry with the same launch identifier
- THEN the same launch MUST be returned
- AND exactly one launch and one `created` event MUST exist

#### Scenario: Rejected launch identifier

- GIVEN a team member
- WHEN creation carries no identifier, or one held by another team or creator
- THEN a missing identifier MUST be rejected as invalid input
- AND a held identifier MUST be denied without disclosure

#### Scenario: Isolation

- GIVEN an outside-team caller
- WHEN they read or mutate a launch
- THEN disclosure and mutation MUST be denied

### Requirement: Closed lifecycle

Launch states MUST be `preparing`, `active`, `archived`, `discarded`, or `trash`. Only eligible `preparing`→`active`, `preparing`→`discarded`, `active`→`archived`/`discarded`, `discarded`→`preparing`, non-trash→`trash`, and `trash`→exact prior state MUST succeed. `discarded`→`preparing` MUST be the sole successful reopen. `archived`→`preparing` and every unlisted transition MUST be rejected without state or history change.

#### Scenario: Reopen

- GIVEN a discarded launch with history
- WHEN a member requests `preparing`
- THEN it MUST become `preparing`
- AND one corresponding transition event MUST follow prior history

#### Scenario: Trash launch

- GIVEN a non-trash launch
- WHEN a member trashes it
- THEN it MUST retain its prior state and enter `trash`

#### Scenario: Restore launch

- GIVEN a trashed launch
- WHEN a member restores it
- THEN it MUST return to its exact pre-trash state

#### Scenario: Reject others

- GIVEN archived→preparing or an unlisted pair
- WHEN its transition is requested
- THEN rejection MUST preserve state and history

### Requirement: Explicit activation

Required-item completion MUST only establish eligibility. Activation MUST be requested and require `preparing`, a snapshot, and complete required items; optional items MUST NOT block it.

#### Scenario: Eligibility

- GIVEN one incomplete required item
- WHEN a member completes it
- THEN the launch MUST remain `preparing`

#### Scenario: Activation

- GIVEN an eligible `preparing` launch
- WHEN activation is requested
- THEN it MUST become `active`

#### Scenario: Required

- GIVEN an incomplete required item
- WHEN activation is requested
- THEN it MUST fail in `preparing`

#### Scenario: Optional

- GIVEN only optional items are incomplete
- WHEN activation is requested
- THEN the launch MUST become `active`

### Requirement: Retention and team deletion

Reopen, restore, and trash MUST preserve the launch record, history, and snapshot. Individual purge MUST be unavailable. Owner-only whole-team deletion MUST be the sole destructive exception, completely removing all team-owned launches and lifecycle records. Non-owner attempts MUST preserve those records and trash recovery.

#### Scenario: Recovery continuity

- GIVEN records precede `discarded`→`preparing` or restoration
- WHEN `discarded`→`preparing` or trash restoration succeeds
- THEN the same launch record, history, and snapshot MUST remain queryable

#### Scenario: Trash retention

- GIVEN launch-owned records
- WHEN their launch enters `trash`
- THEN every record MUST remain recoverable

#### Scenario: Reject purge

- GIVEN a launch
- WHEN permanent purge is attempted
- THEN it MUST be rejected

#### Scenario: Owner deletion

- GIVEN a team owner
- WHEN whole-team deletion succeeds
- THEN no team-owned launch or lifecycle record MUST remain

#### Scenario: Unauthorized deletion

- GIVEN a non-owner
- WHEN whole-team deletion is requested
- THEN rejection MUST retain all team launch data
