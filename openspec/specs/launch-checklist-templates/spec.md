# Launch Checklist Templates Specification

## Purpose

Define private templates, optional defaults, and one template-derived launch snapshot.

## Requirements

### Requirement: Private team templates

At the database boundary, authorization and tenant isolation MUST enforce one-team templates, member maintenance only within their team, and denial of cross-team reads, edits, default selection, and application.

#### Scenario: Maintain template

- GIVEN a team member
- WHEN they create or edit that team's template or items
- THEN the team MUST retain the change

#### Scenario: Deny cross-team access

- GIVEN another team's template
- WHEN a caller reads or mutates it
- THEN disclosure and mutation MUST be denied

### Requirement: Optional default

A team MAY have no default and MUST have at most one. Changing the default MUST only change its designation; it MUST NOT apply or mutate snapshots or launches.

#### Scenario: No default exists

- GIVEN a team has no default
- WHEN a member creates a launch
- THEN its `preparing` launch MUST have no snapshot

#### Scenario: Change default

- GIVEN team-owned templates
- WHEN a member selects one as default
- THEN it MUST be the sole default without changing launches or snapshots

#### Scenario: No default auto-application

- GIVEN a default template
- WHEN a member creates a launch
- THEN no snapshot MUST be applied implicitly

### Requirement: Single template-derived snapshot

A launch MAY receive at most one checklist snapshot, only when a member explicitly applies a same-team template. It MUST copy every current item and required/optional designation. Reapplication, replacement, or creation without a template MUST fail.

#### Scenario: Apply a same-team template

- GIVEN a same-team template and snapshot-free launch
- WHEN a member explicitly applies the template
- THEN one snapshot MUST copy every template item

#### Scenario: Deny cross-team application

- GIVEN a template and launch from different teams
- WHEN a member applies the template
- THEN rejection MUST leave the launch snapshot-free

#### Scenario: Reject replacement

- GIVEN an existing launch snapshot
- WHEN a member reapplies or replaces it
- THEN rejection MUST preserve that snapshot

#### Scenario: Reject direct creation

- GIVEN a snapshot-free launch
- WHEN a member creates a snapshot directly
- THEN rejection MUST leave it snapshot-free

### Requirement: Editable snapshot items

Snapshot items MUST be independently editable. Template edits MUST NOT mutate snapshots; snapshot edits MUST NOT mutate source templates or peer snapshots.

#### Scenario: Template isolation

- GIVEN an applied snapshot
- WHEN its source template changes
- THEN the snapshot MUST remain unchanged

#### Scenario: Snapshot isolation

- GIVEN an applied snapshot
- WHEN its item changes
- THEN its template and peer snapshots MUST remain unchanged

#### Scenario: Missing snapshot blocks activation

- GIVEN a snapshot-free `preparing` launch
- WHEN a member activates it
- THEN rejection MUST NOT apply a template

#### Scenario: Completion does not auto-activate

- GIVEN one required item remains incomplete
- WHEN a member completes it
- THEN eligibility MUST leave the launch `preparing`

### Requirement: Checklist retention and team deletion

Trash MUST retain template-derived snapshots and items. Individual-launch operations MUST NOT purge, replace, or recreate them. Existing owner-only whole-team deletion MUST be the sole destructive exception and completely remove all team-owned templates, template items, snapshots, and snapshot items. Non-owner attempts MUST preserve them. This exception MUST NOT expose individual-launch purge or alter trash recovery.

#### Scenario: Trash retains checklist data

- GIVEN a launch snapshot and items
- WHEN the launch enters `trash`
- THEN both MUST remain recoverable

#### Scenario: Owner deletes all team checklist data

- GIVEN an owner deletes a team
- WHEN whole-team deletion succeeds
- THEN no team-owned template, template item, snapshot, or snapshot item MUST remain

#### Scenario: Deny non-owner checklist-data deletion

- GIVEN a non-owner requests whole-team deletion
- WHEN authorization runs
- THEN rejection MUST retain all team template and snapshot data

### Requirement: Username claim gates template and snapshot writes

At the database boundary, every protected template, template-item, default-selection, template-application, snapshot, and snapshot-item write MUST require the caller to have a claimed username. This gate MUST also cover whole-team deletion and MUST NOT replace existing membership, ownership, single-snapshot, retention, or tenant-isolation checks.

#### Scenario: Usernameless template write is denied

- GIVEN an otherwise authorized team member has no username
- WHEN it attempts a template, item, or default-selection write
- THEN the write MUST be denied without changing template state

#### Scenario: Usernameless snapshot write is denied

- GIVEN an otherwise authorized team member has no username
- WHEN it attempts template application or a snapshot-item write
- THEN the write MUST be denied without changing snapshot or history state

#### Scenario: Claimed member reaches existing checks

- GIVEN a team member has claimed a username
- WHEN it attempts a protected template or snapshot write
- THEN the system MUST evaluate all existing checklist and authorization requirements
