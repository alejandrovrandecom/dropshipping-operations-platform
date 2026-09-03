# Delta for Launch Checklist Templates

## ADDED Requirements

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
