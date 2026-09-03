# Delta for Identity Session Contracts

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Invalid sessions cannot access protected data

The system MUST deny anonymous callers, expired JWTs, JWTs with tampered signatures, and sessions issued to a finally deleted identity access to protected team data and operations. Denial MUST NOT disclose data from any tenant. Final deletion MUST NOT provide session recovery or restoration.

(Previously: The requirement denied anonymous, expired, and signature-tampered sessions but did not define sessions whose identity was deleted.)

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
