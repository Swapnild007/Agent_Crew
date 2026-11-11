# Android access and the ₹0 deployment candidate

Assessment date 11 November 2026. The selected configuration is an Oracle Always Free Ubuntu VM, a persistent local SQLite database, Bubblewrap, and Tailscale Serve on a Personal tailnet. The Android browser accesses the private HTTPS origin. Tailscale authenticates the device and owner account. Agent_Crew separately verifies the owner login header and requires its existing password and revocable session. Node and the mission worker listen only on loopback. Neither runs at a public endpoint.

## Hosting assessment

| Option | Verified offering | Fit and cost exposure |
|---|---|---|
| Oracle OCI Always Free | A1 Arm allowance of 1,500 OCPU-hours and 9,000 GB-hours per month, equivalent to 2 OCPUs and 12 GB continuously. 200 GB combined boot and block storage, with 47 GB minimum boot per instance. Home-region capacity can be unavailable. Oracle can reclaim idle instances after seven days when its published thresholds are met. | Best conditional fit. A VM can run a persistent Node service and OS-level namespaces. The project checks sandbox capability under the service user. Actual OCI kernel, allocation, networking, persistence and certificate issuance still need an owner-provisioned VM test. [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| Cloudflare Workers Free | 100,000 requests/day, 10 ms CPU/request and 128 MB memory. The isolate can front an existing origin but provides no Linux process namespaces or persistent local SQLite worker. Quick Tunnels are for testing and do not support SSE. | Suitable as a separate inference option. Hosting the UI there would still require a protected execution origin. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| Google Cloud | Eligible e2-micro capacity, 30 GB standard persistent disk and 1 GB outbound under the applicable free tier. An active billing account and eligible US regions apply. External IPv4 on standard VMs has a separate charge. Cloud Run free usage is a billing allowance, and the service does not provide the VM-style OS boundary this worker uses. | A VM is technically closer, but no strict zero-bill configuration was validated. Cloud Run would require redesign and a separate isolated execution backend. [Free program](https://cloud.google.com/free/docs/free-cloud-features#compute) · [IP pricing](https://cloud.google.com/vpc/network-pricing#ipaddress) · [Cloud Run contract](https://cloud.google.com/run/docs/container-contract) |
| GitHub Codespaces | Included compute and storage quotas vary by plan. Idle shutdown, maximum session lifetime and lifecycle retention apply. | Development and test only. Unsuitable for a persistent private service. [Billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) · [Idle timeout](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces) |
| Tailscale Personal | ₹0 plan with up to six users under the current personal offering. Serve provides HTTPS within the tailnet and replaces caller-supplied identity headers. | Chosen private access layer. Requires Android and server enrollment, MagicDNS and HTTPS enablement. No domain purchase. Never enable Funnel for the node. [Personal pricing](https://tailscale.com/pricing) · [Serve](https://tailscale.com/docs/features/tailscale-serve) |

Oracle signup may require payment-method verification and includes a time-limited promotional credit period. The candidate uses only resources labeled Always Free, with no paid upgrade. An actual deployment has not been created. [Oracle signup terms](https://docs.oracle.com/en/learn/cloud_free_tier/)

## Owner setup from Android

1. Use the cloud console in Android Chrome. Only continue on an unupgraded tenancy if the console offers an Always Free Ubuntu VM. A candidate is A1 with 1 OCPU, 4–6 GB RAM and a 50 GB boot disk. Confirm it is counted as Always Free before creating anything. Use the home region. Capacity failure is a deployment blocker. Do not add a paid NAT gateway, load balancer, extra storage, or marketplace image.
2. Generate an SSH key in an Android SSH client such as Termux and retain its private key on the phone. If initial SSH uses the VM's public address, permit TCP 22 only from the phone's current egress IP and remove that rule after tailnet access works. Never permit public TCP 4317 or 443. Keep both cloud security groups and host firewall closed to the public application.
3. Enroll the Ubuntu VM and Android phone in a dedicated Personal tailnet. Enable MagicDNS and HTTPS. Use the tailnet policy example with the actual login in place of the example identity. Use the owner as the only member, tag the VM, and verify access from Android before removing public SSH. If using Tailscale SSH, enable it explicitly with `tailscale set --ssh`; the example permits only the owner to reach the Ubuntu account using check mode.
4. Install Node 24 for the VM architecture, Git, util-linux, SQLite CLI, and Bubblewrap. Use OS packages or verified release artifacts. On Ubuntu 24.04, grant unprivileged user namespace access to the packaged Bubblewrap binary through a narrow AppArmor profile if the distribution does not already provide one. The CI profile shows the exact userns rule. Keep the kernel restriction for unrelated processes. Verify the deploy preflight under the service account.
5. Clone the reviewed feature branch into /opt/agent-crew as an administrator and pin the reviewed commit. Keep code owned by root and readable by a dedicated, non-login agent-crew account. Create /etc/agent-crew/agent-crew.env with mode 0600, populate the exact `https://<node>.<tailnet>.ts.net` origin and actual tailnet login, and leave the provider at mock for guaranteed local inference cost. Set a high-entropy owner password without echoing it or putting it on the command line.

```bash
sudo install -d -m 0700 -o agent-crew -g agent-crew /var/lib/agent-crew
read -rsp 'Agent_Crew owner password: ' crew_owner_input
printf '%s' "$crew_owner_input" | sudo -u agent-crew env AGENT_CREW_DATA=/var/lib/agent-crew node /opt/agent-crew/server.mjs bootstrap
unset crew_owner_input
sudo install -m 644 /opt/agent-crew/deploy/agent-crew.service /etc/systemd/system/agent-crew.service
sudo systemctl daemon-reload
sudo systemctl enable --now agent-crew
sudo tailscale serve --bg http://127.0.0.1:4317
```

Check `tailscale serve status` and confirm private Serve at the configured origin. Confirm `tailscale funnel status` has no public endpoint. Read service diagnostics with `sudo journalctl -u agent-crew`. Register a reviewed Git object directory under /var/lib/agent-crew as the service user with the existing repository CLI. Validate the pinned revision and submit an approval from Android. Systemd refuses startup if the remote settings or isolation are missing. No hosted site is expected until these steps are performed.

For backups, use SQLite's online backup command to a private owner-controlled path, or stop the service and copy its data directory consistently. Transfer the backup using the owner's private tailnet to encrypted storage. Store recovery credentials separately. A reboot or replacement VM can recover committed SQLite checkpoints. An interrupted outbound inference may already have consumed quota. Reservations are deliberately retained. Treat OCI idle reclamation and allocation scarcity as real availability limits.

## Owner identity and mobile install

Enroll a passkey at the tailnet identity provider where supported and protect its account recovery. This uses the provider's WebAuthn flow. Agent_Crew has no app-native WebAuthn enrollment or verification in this milestone. The app uses a host-only Secure/HttpOnly/SameSite=Strict cookie, a 30-minute server-side session scoped to the tailnet origin and identity, password throttles, and session revocation. Exact origin checks cover mutations. Artifacts and SSE are authenticated. SSE keeps the connection active and rechecks session validity. The trust boundary assumes a dedicated host with no untrusted processes able to call the loopback listener. [WebAuthn requirements](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)

Android Chrome may offer Add to Home screen from the private origin. A manifest enables standalone presentation where supported. There is no offline cache of application, identity or evidence. The current tab can display its last in-memory view during an outage and reconnect when the phone is back online. Installation and live passkeys require an actual owner device and deployment to validate.

## Inference and cost

| Mode | Expected cost | Limits |
|---|---|---|
| Deterministic default | ₹0 API | Local deterministic planning and evidence checks. No external model requests. |
| Optional Cloudflare Workers AI Free | ₹0 within the account's Free allocation | 10,000 neurons/day shared across the account. Use an unupgraded Free account. The app additionally limits reservations to 12 requests and 32,000 estimated tokens per UTC day by default, persisted in SQLite. Quota and model errors stop the mission. |
| Open-weight local inference | No provider bill if hosted within free hardware limits | OCI A1 is CPU-only. A smaller model might fit with quantization, but this build has no validated local model runtime or latency result. The hosted 70B option is not a suggested CPU deployment. |
| Paid OpenAI | Disabled in the remote ₹0 unit | The existing local opt-in adapter remains. There is no automatic fallback or cross-provider switch. |

Cloudflare uses the published OpenAI-compatible endpoint and documented function-calling model. Only opt in after verifying the Cloudflare plan is Workers Free, with no paid AI Gateway credits or upgrades. Set AGENT_CREW_PROVIDER=cloudflare, AGENT_CREW_CF_FREE_ONLY=1, AGENT_CREW_CF_ACCOUNT_ID and AGENT_CREW_CF_AI_TOKEN in the root-readable systemd environment file. Use a scoped account token for Workers AI inference. Never put it in Git, browser storage, logs or screenshots. Restart the service. Read current quota reservations in System Settings. If the token or Free-plan attestation is missing, the provider is unavailable. The attestation is an operator declaration. The application does not query billing state. Approving a Cloudflare mission permits sending the objective and selected redacted repository excerpts to that provider. Live Cloudflare inference is unverified pending authorized credentials. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Endpoint contract](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) · [Model capability](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)

Expected recurring infrastructure cost is ₹0 if the listed Always Free and Personal allocations are available and remain in place. No credit usage, renewal, paid fallback, or public hosting is part of this configuration. Android data charges, if any, are part of the owner's existing carrier plan.
