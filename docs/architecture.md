# Architecture decision

Use Node.js 24, its SQLite driver, a single local service, and a dependency-free browser client for the sample workflow. SQLite serializes worker transitions, events and artifact creation in the same transaction. The dispatcher reads the persisted step and due time. A crash before commit rolls back the current transition. The fixture tools are read-only and deterministic, so retrying a rolled-back step has no external side effects. This design uses a fixed sequential plan and does not generalize to external effects without an outbox and tool-level idempotency.

| Candidate | Public implementation and license | Fit for the initial slice |
|---|---|---|
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | MIT. Integrated agent, memory, skills, providers and tool ecosystem. | Reference for capability design. Its broader execution surface would need independent isolation and a separate authorization layer. |
| [LangGraph](https://github.com/langchain-ai/langgraph) | MIT. Graph, checkpoints, human interrupts and optional LangSmith observability. | Candidate for future dynamic workflows. The initial workflow can commit its linear checkpoint and evidence directly in SQLite. |
| [AutoGen](https://github.com/microsoft/autogen) | MIT code, CC BY 4.0 documentation. Event-driven and conversation-based multi-agent APIs. The repository reports archival. | Useful as a design reference. New runtime adoption would inherit maintenance risk. |
| [CrewAI](https://github.com/crewAIInc/crewAI) | MIT. Role-based Crews and event-driven Flows with SQLite persistence. | Possible future Python option. The current fixture review has no inference, provider cost, or framework runtime to operate. |

The framework comparison is a documentation and public repository review. Package-level runtime compatibility, comparative performance and hosted observability costs were not benchmarked. The fixed pipeline was chosen to verify transaction boundaries and the owner control surface before adding open-ended tool delegation.

## Implemented and pending

- The Coordinator delegates a fixed review to Research, Engineering and Verification. The UI displays their capabilities and the sequence of dependencies.
- The server provides a versioned owner-session API and authenticated event replay. JAARVIS and SAARTHI are untouched.
- Agent Studio supports inspection only. Memory Vault stores owner-authored notes. Skill Forge saves versioned drafts without activation.
- The model gateway, dynamic dependency graphs, arbitrary authorized repository ingestion, extensible worker configuration, skill activation and rollback, automated knowledge retention, and machine credentials are pending.
- The general-purpose execution sandbox, retry/backoff for external calls, and deployment security gates are pending. No hosted deployment is part of this draft.

## Milestone 2

SQLite migration 002 preserves legacy missions and stores allowlist identity, agent configuration, graph nodes, output, attempt counts, budget reservations and fenced leases. The server keeps the receipt workflow separate from repository dispatch. Approved repository missions use a bounded model-planned DAG with three required specialist roles. Multiple ready nodes are scheduled serially. Worker output becomes visible transactionally with its checkpoint and journal event. Interrupted work can be leased again after five seconds. Outbound model requests may be repeated after an ambiguous crash. Budget reservation is durable and the only repository operations are read-only.

The provider interface prepares one named structured function call per request. The OpenAI adapter uses Chat Completions with strict function schemas, output limits, no redirects, timeouts and sanitized status codes. A byte-count bound plus overhead limits input and reserves worst-case cost according to configured rates. Coordinator plans are validated for size, unique nodes, known roles, acyclicity and verifier coverage. Research inventories allowed Git objects. Engineering chooses at most two files per node and submits candidate quotes. Verification re-reads the files and independently checks exact excerpts and original blob digests before requesting a separate semantic assessment. A model verdict cannot override a missing excerpt. This provides evidence verification for a static investigation. It cannot prove program behavior or reproduce arbitrary defects.

Browser screens expose live mission and node states, graph dependencies, real audit events, role guidance and enablement, versioned draft skill permission checks, and provider configuration status. Scope is read-only. Skill drafts have no activation or plugin authority. No external repository mutations, repository-code execution, hosted authentication, or machine credentials are included. JAARVIS and SAARTHI are separate products.
