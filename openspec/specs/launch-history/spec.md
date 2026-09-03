# Launch History Specification

## Purpose

Define launch history.

## Requirements

### Requirement: Exact append-only event scope

The system MUST append one event for creation, each successful transition, and successful template application. Failed or routine note, URL, checklist-item, template, and default operations MUST append none. Events MUST NOT be mutated individually.

#### Scenario: Creation event

- GIVEN a valid launch request
- WHEN creation succeeds
- THEN exactly one creation event MUST be appended

#### Scenario: Transition event

- GIVEN existing history
- WHEN a lifecycle transition succeeds
- THEN exactly one corresponding event MUST follow it

#### Scenario: Template event

- GIVEN a snapshot-free launch
- WHEN same-team template application succeeds
- THEN one application event MUST be appended

#### Scenario: Failed operation

- GIVEN existing history
- WHEN transition or template application fails
- THEN history MUST remain unchanged

#### Scenario: Routine edit

- GIVEN a routine field or item
- WHEN its edit succeeds
- THEN history MUST remain unchanged

#### Scenario: Event mutation

- GIVEN an existing event
- WHEN update or deletion is attempted
- THEN rejection MUST preserve it

### Requirement: Events expose minimum behavioral facts

Events MUST identify launch, team, kind, time, and applicable member initiator. Transition events MUST expose prior and resulting states. Queries MUST use deterministic append order.

#### Scenario: Transition facts

- GIVEN a successful transition
- WHEN an authorized member queries history
- THEN its event MUST identify launch, team, kind, time, initiator, and both states

#### Scenario: Equal-time order

- GIVEN equal-time events
- WHEN authorized queries repeat
- THEN append order MUST remain stable

### Requirement: Team-isolated queries preserve continuity

At the database boundary, authorization and tenant isolation MUST restrict complete append-ordered history queries to current team members and deny cross-team disclosure. Successful `discarded`→`preparing` and `trash`→exact prior-state restoration MUST continue, not replace, history.

#### Scenario: Complete query

- GIVEN a current member
- WHEN team launch history is queried
- THEN all retained events MUST return in append order

#### Scenario: Cross-team query

- GIVEN an outside-team caller
- WHEN launch history is queried
- THEN no event facts MUST be disclosed

#### Scenario: Discarded-to-preparing continuity

- GIVEN history exists for a discarded launch
- WHEN `discarded`→`preparing` succeeds
- THEN exactly one event recording both states MUST follow all prior events

#### Scenario: Trash-restoration continuity

- GIVEN history predates trash
- WHEN exact pre-trash restoration succeeds
- THEN exactly one event recording both states MUST follow all prior events

### Requirement: History retention and team-deletion boundary

Trash MUST retain complete launch history. Individual purge MUST be unavailable. Owner-only whole-team deletion MUST be the sole destructive exception and remove all team launch history without appending a launch event. Non-owner attempts MUST preserve all events and trash recovery.

#### Scenario: Trash retention

- GIVEN existing history
- WHEN its launch enters `trash`
- THEN every event MUST remain member-queryable

#### Scenario: Owner deletes team

- GIVEN a team owner
- WHEN whole-team deletion succeeds
- THEN no team launch event MUST remain
- AND no launch event MUST be appended

#### Scenario: Non-owner deletes team

- GIVEN a non-owner
- WHEN whole-team deletion is requested
- THEN rejection MUST retain all team launch events

### Requirement: Username claim gates history-affecting writes

Every protected operation that can append or otherwise affect launch history MUST require the caller to have a claimed username at the database boundary. Denial by this gate MUST preserve complete history and MUST NOT replace existing event-scope, ordering, authorization, or tenant-isolation requirements.

#### Scenario: Usernameless event-producing operation is denied

- GIVEN an otherwise authorized account has no username
- WHEN it attempts creation, transition, or template application
- THEN the operation MUST be denied and history MUST remain unchanged

#### Scenario: Denial preserves event facts

- GIVEN launch history already exists
- WHEN a usernameless account attempts a history-affecting write
- THEN no event MUST be appended, changed, or removed

#### Scenario: Claimed account retains existing event rules

- GIVEN an account has claimed a username
- WHEN its protected operation reaches history evaluation
- THEN existing event-scope and authorization requirements MUST still apply
