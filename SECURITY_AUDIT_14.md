# Security Audit 14

Version: **1.0**  
Status: **Mandatory engineering gate**

The supplied reference screenshot shows an `AUDIT_PROMPT.md · 14 checks` panel, but only five checks are readable. Controls 1–5 below preserve those visible checks. Controls 6–14 are our mandatory expansion based on OWASP ASVS / OWASP Top 10 and GitHub secure-development practice; they are not claimed to be the unseen reel text.

## Release rule
- **FAIL**: fix before merge/release.
- **WARN / MANUAL**: provide review evidence when applicable.
- **N/A**: justify from architecture.
- CI is necessary evidence, not the whole security review.

## 14 controls
1. **Server-side admin + role authorization** — privileged routes/actions enforced on trusted server/service boundaries; UI hiding is never authorization.
2. **No secrets in browser/client bundles** — no privileged keys/tokens/passwords/signing secrets in frontend code or public env prefixes.
3. **Price, quantity, coupons + critical business rules server-side** — trusted side recalculates/validates money, entitlement, quota, permission and workflow state.
4. **OTP + login rate-limited** — throttle authentication, OTP, reset, invite and token-issuance abuse.
5. **SQL, XSS, uploads, .env locked down** — parameterized DB access, safe output/DOM handling, allowlisted upload type/size/content/name/storage, no committed real env secrets.
6. **CSRF + CORS + origin trust** — protect cookie-authenticated state changes; no credentialed wildcard CORS.
7. **Session/cookie/token security** — secure randomness/framework sessions, expiry, revocation/rotation, Secure/HttpOnly/SameSite cookies as applicable; no session IDs in URLs/logs.
8. **HTTPS + security headers** — HTTPS in production and applicable CSP/HSTS/frame/content-type/referrer/cache controls.
9. **Dependency + CI/CD supply-chain safety** — lockfiles, vulnerability review, least-privilege CI, immutable full-SHA GitHub Actions (or workflow dependency lockfiles).
10. **Security logging + alerting** — log auth failures, privilege changes and critical actions without passwords/raw tokens/session IDs/secrets.
11. **Safe errors + fail closed** — no internal stack/SQL/path/config leakage; security failures deny by default.
12. **SSRF / redirect / path-traversal defense** — strict allowlisting/canonicalization for untrusted URLs, redirects and filesystem paths.
13. **Cryptography + sensitive-data protection** — trusted modern crypto/CSPRNG, no homemade crypto, protected transport/storage and separated key management.
14. **Secure defaults + least privilege** — no unnecessary debug/default accounts/services; minimum filesystem/cloud/database/API/CI permissions.

## PR evidence template
```text
Security Audit 14
1 Access control: PASS / N/A — evidence:
2 Browser secrets: PASS / N/A — evidence:
3 Business rules: PASS / N/A — evidence:
4 Auth/OTP rate limit: PASS / N/A — evidence:
5 SQL/XSS/uploads/env: PASS / N/A — evidence:
6 CSRF/CORS: PASS / N/A — evidence:
7 Session/token: PASS / N/A — evidence:
8 HTTPS/headers: PASS / N/A — evidence:
9 Supply chain: PASS / N/A — evidence:
10 Security logging: PASS / N/A — evidence:
11 Fail closed/errors: PASS / N/A — evidence:
12 SSRF/redirect/path: PASS / N/A — evidence:
13 Crypto/data protection: PASS / N/A — evidence:
14 Least privilege/config: PASS / N/A — evidence:
```

## Automation
Run `node scripts/security-audit.mjs`. High-confidence failures block CI; architecture-sensitive controls are reported for manual evidence. Static scanning does not replace threat modeling, tests, dependency review or penetration testing.
