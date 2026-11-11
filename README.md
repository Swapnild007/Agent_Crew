# Agent_Crew

Owner-operated mission execution and verification workspace. This draft implements a deterministic review of a bundled receipt calculator, from mission submission through delegated inspection, scoped approval, independent verification, and evidence download.

## Run locally

Install Node.js 24 or later. On Bash, run these commands from the repository root.

```bash
read -rsp 'Owner password (16–256 characters): ' crew_password
printf '%s' "$crew_password" | npm run bootstrap
unset crew_password
npm start
```

Open http://127.0.0.1:4317. The service binds to loopback and requires a bootstrap password. For a private development instance, set PORT or AGENT_CREW_DATA before bootstrap and startup. The SQLite database is created in data/ by default. Keep the data directory private.

To rotate the password, repeat the bootstrap commands with `node server.mjs rotate` in place of `npm run bootstrap`. Rotation revokes all sessions. Back up the SQLite database through SQLite's backup facility, or shut down the service before copying its database directory. Store backups on encrypted storage and restrict filesystem access.

## Demonstrate the workflow

1. Sign in as owner. Start the sample review in Mission Control.
2. Open Mission Canvas for delegation and Execution Terminal for tool events.
3. Open Approval Center and approve the fixed verification run.
4. Open Artifact Workspace and inspect the JSON report. The multiple-quantity case expects 1,900 minor units and produces 700.
5. Use System Settings to pause dispatch or revoke sessions.

The review always targets the bundled sample. Objective text is recorded as owner context. The system has no credentials, model calls, shell execution, arbitrary repository ingestion, or external mutations in this build.

## Verification

- `npm test` runs the integration test, including a forced process shutdown after delegation, recovery with the original database and session, approval enforcement, exact tool-call count, evidence inspection, SSE replay, cancellation, CSRF rejection and session revocation.
- `python test/browser.py` runs the Chromium workflow with Python Playwright. Set CHROMIUM_PATH for a system Chromium binary. Set AGENT_CREW_SCREENSHOTS to save screenshots.

The GitHub Actions browser job captures desktop and mobile screenshots as a workflow artifact after a successful run.

[Architecture and delivery gaps](docs/architecture.md) · [Threat model and deployment limits](docs/security.md) · [Versioned API](docs/api.md)
