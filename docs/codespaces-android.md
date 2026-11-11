# Agent_Crew on Android with GitHub Codespaces

This is an on-demand setup for a personal GitHub Free account without a payment method. The existing Oracle and Tailscale route remains available to users who can provision it. Codespaces has a separate access mode and uses the deterministic provider only.

## Start from Android

1. Sign in to GitHub in Android Chrome. Check [Codespaces settings](https://github.com/settings/codespaces) and set **Default idle timeout** to **15 minutes**. In [billing usage](https://github.com/settings/billing), check your remaining Codespaces compute and storage. Leave payment methods and paid overages disabled.
2. Open [Draft PR #1](https://github.com/Swapnild007/Agent_Crew/pull/1). From the repository, select the `codex/mission-control` branch, then **Code → Codespaces → Create codespace on codex/mission-control**. Choose the smallest available **2-core** machine. Open it in the browser. If Chrome crowds the editor, its Desktop site view can make the terminal and Ports panel easier to reach. No desktop hardware is needed.
3. In the browser editor, open **Terminal → New Terminal**. Check the environment and provision the app owner once. Use a password different from your GitHub password. Keep it in your phone’s password manager.

```bash
npm run codespace:check
read -rsp 'Agent_Crew owner password: ' crew_owner_input
printf '%s' "$crew_owner_input" | npm run bootstrap
unset crew_owner_input
npm run codespace:start
```

4. In the editor’s **Ports** panel, confirm **4317** is **Private**. If absent, forward 4317 and verify its visibility before opening it. Leave the upstream port protocol at HTTP. GitHub provides the external HTTPS connection. Do not use Public or Organization visibility. Open the port’s forwarded address in Android Chrome while signed in to the GitHub account that created the Codespace. Sign in again with the Agent_Crew owner password.
5. From a signed-out Chrome incognito tab, open the same forwarded address. It should require GitHub sign-in or deny access. Verify it never shows a usable Agent_Crew workspace. On a second signed-in browser tab with no Agent_Crew session, the app should ask for its owner password. A forwarded address alone is insufficient to use the application. The application does not query GitHub for port visibility. The Ports panel and the signed-out check verify the actual platform boundary.
6. When finished, explicitly **Stop codespace** from [Your codespaces](https://github.com/codespaces). Stopping compute keeps stored data and avoids waiting for idle timeout. On the next start, rerun only `npm run codespace:start`.

GitHub documents private visibility as the default and allows only the creator through the private port after GitHub authentication. The application separately checks the exact GitHub-assigned HTTPS origin and requires its own scoped Secure/HttpOnly/SameSite=Strict session. State-changing routes require the exact origin and a request header. Events and artifacts require authentication. The Node listener is on loopback, with only one application port forwarded. Repository tools have no separate public listener. [GitHub Codespaces security](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces)

## Sandbox and available workflows

The image uses Node 24 on Debian with Git, util-linux and Bubblewrap. It does not request privileged mode, extra capabilities, a Docker socket, or relaxed seccomp. The startup probe and application independently check Bubblewrap. If namespace isolation is denied, repository registration and execution fail closed, and Mission Control reports unavailable isolation. The nine screens and bundled receipt workflow remain usable, including approval, events, notes and downloadable evidence. Choose **Start sample review** for the first run. If the actual Codespace permits the sandbox, register only an owner-approved Git directory and commit via the existing repository CLI. Never enable elevated container privileges to get the repository workflow working.

GitHub-hosted Actions can test the image and app with a local HTTPS proxy fixture. That validates the app’s access contract and an Android touch profile. The actual GitHub private forwarding gateway, the live Codespaces kernel and the owner’s physical Android still require the two signed-out/signed-in checks above and `npm run codespace:check` in the real Codespace.

## Persistent data and encrypted backup

The devcontainer stores data in the ignored `data/` directory inside the Git checkout under `/workspaces`. GitHub preserves that workspace through stop/start and container rebuild. Deleting the Codespace removes its local storage. Uncommitted mission state never belongs in Git. [Codespace persistence](https://docs.github.com/en/codespaces/developing-in-a-codespace/rebuilding-the-container-in-a-codespace)

Create an encrypted database snapshot before deleting the Codespace or after important missions. Use a distinct strong backup passphrase. The export takes a consistent SQLite snapshot and excludes active sessions. It includes mission data and the app owner's password hash. Provider credential files and Git object directories are excluded.

```bash
read -rsp 'Backup passphrase: ' crew_backup_input
printf '%s' "$crew_backup_input" | node backup.mjs create data/agent-crew.crew-backup
unset crew_backup_input
```

In the browser editor, download the encrypted `data/agent-crew.crew-backup` from the Explorer to Android. Keep the passphrase separate. Use another filename for the next snapshot. Backups are capped at 64 MiB of database content and never overwrite existing files.

To restore in a new Codespace, leave the app stopped and skip bootstrap. Upload the encrypted file in the browser editor into the checkout. Restore to a fresh data directory.

```bash
read -rsp 'Backup passphrase: ' crew_backup_input
printf '%s' "$crew_backup_input" | node backup.mjs restore agent-crew.crew-backup
unset crew_backup_input
npm run codespace:start
```

Use the original app password. Existing sessions stay revoked. Sample missions recover their checkpoints. Pending or running repository investigations are cancelled on restore and must be submitted again after reauthorizing the Git directory and revision. Historical evidence stays available. Delete uploaded backup copies from the Codespace once you have the encrypted copy stored safely on Android.

## ₹0 limits

GitHub Free personal accounts include **120 core-hours and 15 GB-month of storage** per month. A 2-core Codespace uses roughly two included core-hours per active hour, or up to roughly 60 active hours if storage and other Codespaces do not exhaust your quota first. Stopped Codespaces still count toward storage. Without a valid payment method, GitHub blocks further Codespaces usage when the included quota is exhausted. The app always runs deterministic inference in this mode. [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) · [Idle timeout](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces)
