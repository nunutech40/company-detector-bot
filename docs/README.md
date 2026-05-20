# Documentation Index

Root `README.md` is the entry point. The canonical project direction lives in `PRD.md` and `TRD.md`.

For AI agents continuing the work, read [FETCH_CONTEXT.md](../FETCH_CONTEXT.md) first.

---

## Primary Docs

| Doc | Purpose |
|---|---|
| [PRD](product/PRD.md) | Product source of truth: goals, classifications, product workflow, roadmap |
| [TRD](technical/TRD.md) | Technical source of truth: architecture, storage, services, deployment |
| [Flow Map](technical/FLOW_MAP.md) | Runtime flow and decision points |
| [Backlog](../BACKLOG.md) | Implementation status and next work |

---

## Product Docs

| Doc | Status | Notes |
|---|---|---|
| [High Level Business Flow](product/HIGH_LEVEL_BUSINESS_FLOW.md) | Current | Business-readable flow |
| [PRD](product/PRD.md) | Current | Product source of truth |
| [Product Workflow And Storage Plan](product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md) | Current summary | Storage workflow after implementation |
| [Next Level Enrichment Plan](product/NEXT_LEVEL_ENRICHMENT_PLAN.md) | Future plan | Enrichment ideas not fully implemented |

---

## Technical Docs

| Doc | Status | Notes |
|---|---|---|
| [TRD](technical/TRD.md) | Current | Technical source of truth |
| [Flow Map](technical/FLOW_MAP.md) | Current | Runtime flow |
| [DB And Dashboard](technical/DB_AND_DASHBOARD_PLAN.md) | Current | Actual 3-table schema and dashboard |
| [Webhook API](technical/WEBHOOK_API.md) | Current | `POST /webhook/check` |
| [Migration v1](technical/migration_v1.sql) | Current | PostgreSQL schema |
| [Tools And Algorithms](technical/TOOLS_AND_ALGORITHMS.md) | Reference | Tool/algorithm notes |

---

## Runtime Docs

| Doc | Purpose |
|---|---|
| [AGENTS.md](../openclaw_workspace/AGENTS.md) | OpenClaw agent behavior |
| [STANDING_ORDERS.md](../openclaw_workspace/STANDING_ORDERS.md) | Persistent runtime instructions |
| [TOOLS.md](../openclaw_workspace/TOOLS.md) | Runtime tool notes |
| [tool_catalog.yaml](../openclaw_workspace/config/tool_catalog.yaml) | Enabled/disabled tool registry |
| [scoring_rules.yaml](../openclaw_workspace/config/scoring_rules.yaml) | Scoring thresholds and rules |

---

## Archived Or Historical

| Doc | Notes |
|---|---|
| [Building Plan OpenClaw Telegram MVP](archive/BUILDING_PLAN_OPENCLAW_TELEGRAM_MVP.md) | Historical MVP build plan |
| [Go Transition Plan](archive/GO_TRANSITION_PLAN.md) | Historical Node.js to Go transition |
| [Go Transition Checklist](archive/GO_TRANSITION_CHECKLIST.md) | Historical checklist |
| [Project Implementation Review](reviews/PROJECT_IMPLEMENTATION_REVIEW.md) | Older review; use backlog for current status |

---

## Maintenance Rule

- Update `PRD.md` for product direction.
- Update `TRD.md` for technical architecture.
- Update `FLOW_MAP.md` when runtime flow changes.
- Update `BACKLOG.md` when status changes.
- Keep planning docs short once implementation is done.

