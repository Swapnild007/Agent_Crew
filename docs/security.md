# Local threat model

Protected assets include the owner account, session tokens, objective text, logs, notes, and verification evidence. The trust boundary is the loopback HTTP service plus the operating system account that owns its SQLite files. The browser may submit untrusted text. Only bundled, reviewed code runs in this process. The browser escapes user text and source evidence before rendering them.

| Threat | Control in this draft |
|---|---|
| Unauthenticated API or stream | Server-side owner session lookup on each request. Streams recheck validity before each event batch. |
| Session theft or replay | 256-bit random tokens, token digests at rest, HttpOnly and SameSite=Strict, 30-minute expiry, session revocation and local rotation. |
| Cross-site requests and DNS rebinding | Exact loopback Host, exact Origin and custom header on writes. No CORS. |
| Login guessing | Persistent owner login throttling and scrypt password hashing. |
| Arbitrary command execution and prompt injection | No LLM, dynamic tools, shell, uploads, network tools, or plugin activation. The request body cannot choose a script or path. |
| Unauthorized approval | Per-mission state and expiry enforced transactionally. Verification requires a recorded approval. Dispatch can be paused. |
| Artifact tampering | SHA-256 stored at artifact creation and verified on read. A compromised database writer is outside this integrity boundary. |

Local HTTP does not use a Secure cookie or TLS. Do not publish this service on a network or put it behind a public proxy. Hosted use requires a reviewed TLS and private access design, Secure cookie, passkeys or MFA, scoped machine credentials, monitored security controls, and an independent isolation boundary before introducing untrusted execution. A host administrator or a process running as the owner can read or modify the database. At-rest encryption relies on the host volume. Existing approvals authorize only the bundled fixture operation.
