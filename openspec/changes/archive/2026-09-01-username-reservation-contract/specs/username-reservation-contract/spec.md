# Username Reservation Contract Specification

## Purpose

Define the backend-only username contract required before account deletion, without onboarding UI or a public directory.

## Requirements

### Requirement: Permanent username reservation

The system MUST accept only 3–30 character lowercase usernames matching `[a-z0-9_]`. It MUST permit exactly one successful claim per account; that globally unique username MUST be immutable and remain permanently unavailable after profile or account deletion. Reservation data MUST NOT retain email or full-profile data.

#### Scenario: Valid first claim

- GIVEN a confirmed account without a username
- WHEN it claims an unreserved valid username
- THEN that username MUST become its sole permanent claim

#### Scenario: Invalid username

- GIVEN a candidate outside the required character or length rules
- WHEN a claim is attempted
- THEN the claim MUST be rejected without creating a reservation

#### Scenario: Deletion preserves reservation

- GIVEN an account has claimed a username
- WHEN its profile or account is deleted
- THEN the username MUST remain reserved and MUST NOT expose email or full-profile data

### Requirement: Atomic and disclosure-safe claims

Claims MUST be atomic. Concurrent claims for the same username MUST produce exactly one winner. Rejections MUST be controlled and indistinguishable when distinguishing an unavailable username, prior claim, or account state would disclose protected facts.

#### Scenario: Concurrent duplicate claims

- GIVEN two eligible accounts concurrently claim the same available username
- WHEN both claims are evaluated
- THEN exactly one MUST succeed and one controlled rejection MUST occur

#### Scenario: Unavailable and repeat claims are indistinguishable

- GIVEN a username is reserved or the account has an existing claim
- WHEN the caller receives the rejection
- THEN the same controlled rejection MUST NOT reveal username availability or account state

### Requirement: Claim-only onboarding gate

Only a confirmed account without a username MUST be allowed to claim one. Such an account MUST be denied every other protected write; an account with a claim MAY proceed to existing authorization checks.

#### Scenario: Usernameless account claims

- GIVEN a confirmed account has no username
- WHEN it submits a valid first claim
- THEN the claim MUST be the only protected write permitted by this gate

#### Scenario: Usernameless account attempts another write

- GIVEN a confirmed account has no username
- WHEN it attempts any other protected write
- THEN the write MUST be denied without side effects

### Requirement: Team-scoped username resolution

The system MUST resolve a user ID to a username only when caller and subject are current members of the same identified team. It MUST NOT provide global enumeration, broad registry reads, or reservation-status disclosure.

#### Scenario: Shared-team resolution

- GIVEN caller and subject are current members of the same team
- WHEN the caller resolves that subject in that team
- THEN the subject's username MUST be returned

#### Scenario: Non-shared user is hidden

- GIVEN caller and subject do not share the identified team
- WHEN resolution is attempted
- THEN no username or reservation status MUST be disclosed

#### Scenario: Registry enumeration is denied

- GIVEN an authenticated caller
- WHEN it requests an unscoped or broad registry read
- THEN the system MUST deny the request without returning reservations

### Requirement: Backend-only adoption scope

This change MUST define backend behavior only and MUST NOT add user-visible onboarding or a legacy backfill contract. Local and test environments MAY recreate accounts to adopt this contract.

#### Scenario: Local or test recreation

- GIVEN a local or test account predates username reservation
- WHEN the environment adopts the contract
- THEN it MAY recreate the account without defining a legacy backfill flow

#### Scenario: No onboarding UI is introduced

- GIVEN the username reservation contract is adopted
- WHEN the change's exposed behavior is assessed
- THEN it MUST contain no user-visible onboarding flow
