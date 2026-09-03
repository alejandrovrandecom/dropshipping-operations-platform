# Delta for Launch History

## MODIFIED Requirements

### Requirement: Events expose minimum behavioral facts

Events MUST identify launch, team, kind, time, and the applicable member initiator while that identity exists. Transition events MUST expose prior and resulting states. After definitive account deletion, a former-account initiator reference MAY be null; the event's other facts and deterministic append order MUST remain queryable by authorized team members without exposing deleted identity PII.

(Previously: Every applicable event exposed its member initiator without defining retained history after that identity was deleted.)

#### Scenario: Transition facts

- GIVEN a successful transition whose initiator still exists
- WHEN an authorized member queries history
- THEN its event MUST identify launch, team, kind, time, initiator, and both states

#### Scenario: Equal-time order

- GIVEN equal-time events
- WHEN authorized queries repeat
- THEN append order MUST remain stable

#### Scenario: Deleted initiator preserves history

- GIVEN a retained event was initiated by a finally deleted account
- WHEN an authorized current team member queries history
- THEN its former-account initiator MAY be null
- AND all other facts and append order MUST remain unchanged

#### Scenario: Deleted initiator remains tenant-isolated

- GIVEN retained history has a null former-account initiator
- WHEN an outside-team caller queries it
- THEN no event fact or deleted identity PII MUST be disclosed
