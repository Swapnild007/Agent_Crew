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
