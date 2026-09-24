# scripts/

Controlled operational utilities.

Declared in the canonical repository structure:
- `07_TECHNICAL_ARCHITECTURE.md` section 13
- `15_DEVOPS_DEPLOYMENT.md` section 18
- `18_IMPLEMENTATION_ROADMAP.md` section 24

## Planned contents

| Script | Purpose | Milestone |
| --- | --- | --- |
| Job provisioning utility | Create/update Job records without editing frontend source | B3 (Doc 18 section 109) |
| Index check / apply | `db:indexes:check`, `db:indexes:apply` | B2 (Doc 18 section 102) |
| Storage reconciliation | `ops:storage:reconcile` | Doc 15 section 928 area |
| Development seed utilities | Synthetic local data only | B2/B3 |

## Rule

Scripts must not become an uncontrolled shadow Admin system
(`07_TECHNICAL_ARCHITECTURE.md` section 13). Anything that changes operational
state must validate its input and respect the same business rules as the API.

## Status

No operational script exists yet; the planned utilities above arrive with
Release B.

Frontend build tooling is deliberately kept with the frontend package rather
than here: the A6 quality budget gate is
`frontend/scripts/check-quality-budgets.mjs`, run with
`npm run verify:budgets` from `frontend/`. It measures the production build and
changes no operational state, so it is not an operational utility in the sense
of this directory.
