# Identity Session Contracts Specification

## Purpose

Define confirmed account-email synchronization, invitation identity matching, invalid-session denial, and team-local authorization cutoff while preserving tenant isolation and live database authorization.

## Requirements

### Requirement: Confirmed account email synchronization

When Supabase Auth persists a confirmed account email change, the system MUST synchronize `profiles.email` for that account. The system MUST NOT synchronize an unconfirmed requested address or alter another account's profile.

#### Scenario: Confirmed email change updates the profile

- GIVEN an account has a profile and confirms a different account email
- WHEN Supabase Auth persists the confirmed email
- THEN that account's `profiles.email` MUST equal the confirmed email

#### Scenario: Unconfirmed email request remains inactive

- GIVEN an account has requested but not confirmed a different email
- WHEN the account's confirmed email remains unchanged
- THEN `profiles.email` MUST retain the existing confirmed email

#### Scenario: Synchronization is account-local

- GIVEN two accounts have distinct profiles
- WHEN one account's confirmed email is synchronized
- THEN the other account's profile MUST remain unchanged

### Requirement: Invitation matching uses synchronized email

For an otherwise valid invitation acceptance, the system MUST match the invitation recipient against the authenticated account's synchronized `profiles.email`. After synchronization, the previous email MUST NOT identify that account for invitation matching.

#### Scenario: Invitation matches the confirmed new email

- GIVEN an authenticated account's confirmed new email is synchronized to `profiles.email`
- AND an otherwise valid pending invitation targets that email
- WHEN the account accepts the invitation
- THEN the invitation MUST match that account

#### Scenario: Invitation does not match the previous email

- GIVEN an authenticated account's confirmed new email is synchronized to `profiles.email`
- AND an invitation targets the account's previous email
- WHEN the account attempts acceptance
- THEN the system MUST deny the acceptance

### Requirement: Invalid sessions cannot access protected data

The system MUST deny anonymous callers, expired JWTs, JWTs with tampered signatures, and sessions issued to a finally deleted identity access to protected team data and operations. Denial MUST NOT disclose data from any tenant. Final deletion MUST NOT provide session recovery or restoration.

#### Scenario: Anonymous caller is denied

- GIVEN a request has no authenticated session
- WHEN it reads or mutates protected team data
- THEN the system MUST return no protected data and MUST reject mutation

#### Scenario: Expired JWT is denied

- GIVEN a request presents an otherwise valid JWT whose expiry has passed
- WHEN it accesses protected team data or operations
- THEN the system MUST deny authenticated access

#### Scenario: Signature-tampered JWT is denied

- GIVEN a request presents an unexpired JWT with an invalid signature
- WHEN it accesses protected team data or operations
- THEN the system MUST deny authenticated access

#### Scenario: Deleted identity session is denied

- GIVEN a token was issued before its identity reached final deletion
- WHEN that token accesses protected data or operations afterward
- THEN the system MUST deny access without restoring identity or tenant associations

### Requirement: Deletion-safe identity and invitation references

Finalization MUST delete the account's email and `display_name` and MUST cancel pending invitations both issued by and addressed to that account. Historical identity references MAY become null where facts must survive, but they MUST NOT retain deleted profile PII or permit a canceled invitation to be accepted.

#### Scenario: Issued invitations are canceled

- GIVEN the deleting account issued pending invitations
- WHEN finalization completes
- THEN none of those invitations MUST remain acceptably pending

#### Scenario: Addressed invitations are canceled

- GIVEN pending invitations target the deleting account's email
- WHEN finalization completes
- THEN none of those invitations MUST remain acceptably pending

#### Scenario: Historical reference survives without PII

- GIVEN a retained fact references the deleting identity
- WHEN finalization removes the profile
- THEN the reference MAY become null while the fact remains
- AND no deleted email or display name MUST be exposed

### Requirement: Membership removal has team-local immediate effect

The system MUST evaluate team authorization against live membership state at the database boundary. After membership removal, the removed account's next request MUST lose authorization for that team without global sign-out. Removal from one team MUST NOT revoke a valid session or authorization independently held for another team.

#### Scenario: Removed member loses access on the next request

- GIVEN an account has a valid session and membership in a team
- WHEN that membership is removed
- THEN the same session's next request MUST be unable to read or mutate that team's protected data

#### Scenario: Removal does not end unrelated team access

- GIVEN an account has a valid session and memberships in two teams
- WHEN its membership is removed from one team
- THEN the session MUST remain valid and authorized for the other team
- AND the removed team's data MUST remain inaccessible

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
