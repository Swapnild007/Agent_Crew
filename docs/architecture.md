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
