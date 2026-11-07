# docs/

Decisions, the reasons behind the hard rules, the office design, and the
backlog. Read a doc's status before acting on it: **proposed** (not agreed),
**ratified** (agreed, not built), **built** (in the code), **historical**
(kept for reference).

- [decisions/CLAUDE.md](decisions/CLAUDE.md). The ledger, one file per decision. How to find, record and supersede one.
- `office.gif`. The animation at the top of the README. `npm run office-gif -w @oddboro/site` makes it.
- `hard-rules.md`. **Ratified.** The reason behind each hard rule in the root `CLAUDE.md`, one section per rule, same order.

- [magpie.md](magpie.md). **Built on the integration branch.** Native model connections, managed and existing ownership, supported account flows, runtime packaging and release evidence limits.
- [magpie-architecture.md](magpie-architecture.md). **Built on the integration branch.** Maintainer reading map, connection and runner boundaries, packaging contracts and extension checks.
