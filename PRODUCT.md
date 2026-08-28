# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router with TypeScript on Vercel, backed by Supabase Postgres, Auth, and Row Level Security. The application is planned as a modular monolith with version-controlled Supabase migrations and configuration.

## Users

Independent dropshippers and small teams operating globally. They need a shared, repeatable way to evaluate product candidates, coordinate launch preparation, and maintain momentum across multiple launches without losing operational history.

## Product Purpose

The product is a multi-tenant dropshipping operations SaaS that moves product candidates through configurable launch workspaces. Each workspace combines staged checklists, URLs, notes, relevant data, lifecycle history, reusable templates, and activation goals.

Success means teams can prepare launches consistently, understand readiness at a glance, activate only when required work is complete, and preserve a trustworthy record across the full lifecycle.

## Positioning

The product treats each candidate as a durable operational record rather than a disposable task list. Configurable required and optional checks, immutable template snapshots, explicit lifecycle transitions, and cycle-aware activation goals connect launch readiness, execution history, and team cadence in one workflow.

## Operating Context

- A user creates or joins a team workspace and works only with that team's launches, templates, settings, history, and goals.
- Teams configure country, currency, timezone, stages, and required or optional checklist items.
- Members capture product URLs, notes, relevant data, checklist progress, and launch events while preparing a candidate.
- Teams reuse checklist templates, while each applied launch receives an independently editable snapshot.
- Launches move through draft, active, archived, discarded, and trash states. Restore recovers the pre-trash state; permanent purge is not part of the product.
- Reopening a discarded launch keeps the same record and history while starting a new eligible work cycle.
- Weekly and monthly goal progress is based on valid activations in the team's timezone, with weeks running Monday through Sunday.

## Capabilities and Constraints

- Authentication and isolated team workspaces are foundational. Cross-team access must be denied at the database boundary.
- Team owners invite members by email using expiring, single-use invitations. Members share operational permissions; only the owner can remove members or delete the team.
- A launch can activate only when every required checklist item is complete. Optional items never block activation, and failed activation must identify every blocker.
- Each launch cycle can count once toward weekly and monthly goals when it validly transitions to active. Repeated actions while already active do not add credit.
- Archive and trash are distinct: archived launches remain part of normal retained history, while trashed launches are hidden from normal views and remain restorable.
- Templates are reusable, but edits affect only future applications and never mutate existing launch progress or history.
- Database schema, policies, grants, and privileged functions must be reproducible from reviewed, version-controlled artifacts. Privileged keys must never reach browser code or the repository.
- Product naming, pricing, licensing, analytics, calculator rules, Dropi ingestion, and public deployment claims are not yet confirmed.

## Evidence on Hand

The project has approved SDD product requirements and technical planning, but no application implementation, production data, customer testimonials, case studies, benchmarks, press, logo, or other proof assets. Future work must not fabricate those forms of evidence.

## Product Principles

1. Preserve operational continuity: lifecycle actions change state without erasing the record or its history.
2. Make readiness explicit: required work, blockers, current state, and goal progress must be understandable at a glance.
3. Adapt the workflow without corrupting history: teams can evolve templates and launch details while applied records remain independent and auditable.
4. Protect every tenant by construction: team isolation and least privilege are enforced in the data model, not left to interface conventions.
5. Reward completed process, not activity theater: goals advance only from a valid activation in an eligible cycle.

## Accessibility & Inclusion

Core workflows must support keyboard-only operation, visible focus, clear hierarchy, actionable validation, and understandable loading, empty, and error states across supported desktop and mobile web viewports. Motion must respect reduced-motion preferences. A specific accessibility conformance target has not yet been confirmed.
