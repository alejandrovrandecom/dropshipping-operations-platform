# Delta for Identity Session Contracts

## ADDED Requirements

### Requirement: Username claim gates identity and membership writes

At the database boundary, a confirmed account without a username MUST be allowed to claim its username and MUST be denied every other protected identity, invitation, team, and membership write. This gate MUST include invitation acceptance. A claimed username MUST NOT replace existing session, invitation, role, membership, or tenant authorization checks.

#### Scenario: Claim remains available

- GIVEN a confirmed account has no username
- WHEN it submits its first valid username claim
- THEN the claim gate MUST permit the claim to be evaluated

#### Scenario: Invitation acceptance is denied

- GIVEN a confirmed account without a username has a matching invitation
- WHEN it attempts to accept the invitation
- THEN acceptance MUST be denied without changing the invitation or memberships

#### Scenario: Team or membership write is denied

- GIVEN a confirmed account has no username
- WHEN it attempts any protected team or membership write
- THEN the write MUST be denied without changing team or membership state

#### Scenario: Claimed account retains existing authorization

- GIVEN an account has claimed a username
- WHEN it attempts an identity, invitation, team, or membership write
- THEN the system MUST evaluate all existing authorization requirements
