# Delta for Launch Lifecycle

## ADDED Requirements

### Requirement: Username claim gates launch lifecycle writes

At the database boundary, every protected launch lifecycle write MUST require the caller to have a claimed username. This includes launch creation and edits, lifecycle transitions, trash and restoration, and whole-team deletion. The username gate MUST NOT replace existing membership, ownership, lifecycle, idempotency, or tenant-isolation checks.

#### Scenario: Usernameless lifecycle write is denied

- GIVEN an otherwise authorized account has no username
- WHEN it attempts any protected launch lifecycle write
- THEN the write MUST be denied without changing launch state or data

#### Scenario: Usernameless creation has no effects

- GIVEN a team member without a username
- WHEN it attempts launch creation
- THEN no launch or creation event MUST exist from the attempt

#### Scenario: Claimed member reaches existing checks

- GIVEN a team member has claimed a username
- WHEN it attempts a launch lifecycle write
- THEN the system MUST evaluate all existing lifecycle and authorization requirements
