# Agent_Crew

Private, owner-operated workspace for read-only Git investigations. The Coordinator plans a mission, Research inventories a pinned commit, Engineering collects cited excerpts, and Verification re-reads the source and independently assesses relevance. The original receipt review remains available as a regression workflow.

## Run locally

Install Node.js 24 or later. Repository investigations also require Linux, /usr/bin/git, /usr/bin/prlimit, and Bubblewrap with working user and network namespaces. The service binds to 127.0.0.1. An unavailable isolation boundary disables repository missions. On Bash, run these commands from the project root.

```bash
read -rsp 'Owner password (16–256 characters): ' crew_password
printf '%s' "$crew_password" | npm run bootstrap
unset crew_password
npm start
```

Open http://127.0.0.1:4317. Set PORT or AGENT_CREW_DATA consistently for all commands to use another local port or private database directory. Run the same password procedure with `node server.mjs rotate` to rotate the owner password and revoke sessions. Keep the data directory and backups private and use encrypted host storage.

## Authorize and investigate a repository

Stage an authorized repository under a directory controlled by your OS account. An owner-operated bare clone avoids working-tree filters and submodule execution. Private repos can be fetched separately through your normal Git credential flow.

```bash
git -c fetch.fsckObjects=true clone --bare --no-local --no-recurse-submodules -- <approved-origin> /path/to/project.git
git --git-dir=/path/to/project.git rev-parse HEAD
node server.mjs repository add project /path/to/project.git <full-commit-sha>
```

For an existing normal clone, pass its real .git directory. Use a full commit SHA. Refresh the app, enter the objective in Mission Control, and select the authorized project. Approve the exact revision and provider in Approval Center. Mission Canvas shows task dependencies and node outputs. Execution Terminal shows tools, model calls and verification. Artifact Workspace provides SHA-256-checked JSON evidence. Remove permission with `node server.mjs repository remove project`. Use a new allowlist entry to pin a different revision.

The inspector reads the committed tree, ignores dirty working files, and runs fixed Git plumbing commands inside a restricted namespace. It supports a bounded selection of UTF-8 text and does not execute repository code. The test provider extracts exact source quotes. Evidence verification confirms cited text, while semantic conclusions require review.

## OpenAI configuration

The default deterministic provider is local. Set AGENT_CREW_PROVIDER=openai, AGENT_CREW_MODEL to a supported Chat Completions model, and AGENT_CREW_INPUT_USD_MICROS_PER_MILLION and AGENT_CREW_OUTPUT_USD_MICROS_PER_MILLION to the current published rates. For gpt-5.4-mini, the documented standard rates at implementation were 750000 and 4500000 micro-USD per million tokens. Check the [current provider pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini) before starting. Approval explicitly authorizes submitting the objective and selected redacted evidence to the configured provider. Use the deterministic provider for material that cannot leave the machine.

Supply AGENT_CREW_OPENAI_KEY via the service's secret manager, or provision an encrypted local credential. Inject a random 32-byte hex AGENT_CREW_SECRET_KEY from a separate secret manager, then read the provider credential without echoing it.

```bash
read -rsp 'OpenAI credential: ' crew_credential
printf '%s' "$crew_credential" | node server.mjs store-openai-credential
unset crew_credential
```

Only non-secret status appears in System Settings. Restart to load changed environment or credentials. The budget is a conservative reservation based on bounded serialized context and owner-configured rates. Timeouts and retries may still incur charges. Configure a provider project spending limit separately.

## Verification

- `npm test` runs receipt, model contract, orchestration, approval, repository boundary and credential tests. On a host with working namespaces set AGENT_CREW_REQUIRE_SANDBOX=1 to require the real sandbox checks.
- `pip install -r test/requirements.txt` and `python -m playwright install chromium` set up browser QA. Run `python test/browser.py` from the checkout with AGENT_CREW_REQUIRE_SANDBOX=1 to include the authorized checkout workflow and forced restart. Set AGENT_CREW_SCREENSHOTS to write genuine screenshots. CHROMIUM_PATH can point at a compatible system binary.

[Architecture and limitations](docs/architecture.md) · [Threat model and deployment](docs/security.md) · [Versioned API and JAARVIS design](docs/api.md)

## Android and private cloud access

See the [mobile deployment and ₹0 feasibility assessment](docs/mobile-deployment.md) for the conditional OCI and Tailscale design, service configuration, owner provisioning, and inference options. Use `python test/mobile.py` for an HTTPS Chromium test with the Pixel 7 touch profile. It exercises a local TLS test proxy that implements the Serve header contract. It does not require a cloud account or represent a live tailnet or physical Android test.
