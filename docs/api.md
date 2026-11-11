# API v1

Base address: http://127.0.0.1:4317/api/v1. All data endpoints require the owner session cookie obtained from login. Mutations require same-origin Origin and X-Crew-Request: 1. JSON mutations use Content-Type: application/json.

| Method | Path | Purpose |
|---|---|---|
| POST | /login | Owner password, returns the session cookie |
| GET | /workspace | Recent events, missions, notes, drafts, artifacts, plan and dispatch status |
| GET | /capabilities | Worker roles and available tools |
| POST | /missions | Create bundled review, body objective |
| GET | /missions/{id} | Mission state, approval status and result |
| POST | /missions/{id}/approve | Approve pending fixture verification |
| POST | /missions/{id}/deny | Deny pending fixture verification |
| POST | /missions/{id}/cancel | Cancel eligible mission |
| GET | /missions/{id}/artifact | Retrieve verification JSON and digest |
| GET | /events | SSE, supports Last-Event-ID or after cursor |
| POST | /notes | Save owner note, body text |
| DELETE | /notes/{id} | Delete note |
| POST | /skills | Save a versioned draft, body name and description |
| POST | /settings | Reauthenticate and set paused boolean |
| POST | /logout | Revoke current session |
| POST | /logout-all | Reauthenticate and revoke all sessions |

Errors return an error string and use HTTP 400 for invalid input, 401 for authentication, 403 for rejected origin or reauthentication, 404 for missing resources, 409 for invalid transitions and 429 for throttling. The API contract is available for review. JAARVIS machine access and per-mission resume endpoints are pending. Crash recovery and dispatch resume are already supported by the local runtime.

## Milestone 2 additions

- POST /missions accepts optional repository, an owner-allowlisted alias. Omit it to preserve the receipt review contract. The server selects and pins the commit, records the provider, and returns awaiting_approval. No repository operation can start through this endpoint alone.
- GET /missions/{id}/graph returns persisted node IDs, roles, dependencies, state, attempts and bounded structured output.
- POST /missions/{id}/approve and /deny decide the pending approval. GET /missions/{id} reports the exact requested commit and provider. Cancel is immediate and active work is aborted.
- GET /capabilities includes the available workflows and roles. POST /agents is owner-reauthenticated and accepts role, enabled, guidance and password.
- POST /skills accepts optional tool from catalog_commit, read_tracked_text and recheck_citations. POST /skills/test accepts name and version and validates the draft against the fixed read-only capability policy. This endpoint does not execute source.
- GET /workspace exposes redacted configuration status, allowlisted aliases and revisions, isolation state and optional graph selection. Provider credentials and host paths never appear.

### Future JAARVIS credentials

The versioned API is available through the owner session. Scoped machine authentication is design only. Use separate revocable, expiring credential hashes and select scopes such as mission:create, mission:read, mission:cancel, events:read and artifact:read. Bind repository access to a credential allowlist. Filter events and artifacts to visible missions. A machine may request approval through mission creation. Approval decisions should remain an interactive owner operation. Issue or revoke credentials only after owner reauthentication. Log credential identifiers and scopes, never token values. Neither JAARVIS nor SAARTHI needs shared storage or owner session credentials.
