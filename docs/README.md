# Documentation Index

Dokumentasi aktif dibuat sederhana:

1. [PRD](product/PRD.md) — source of truth produk.
2. [TRD](technical/TRD.md) — source of truth teknis.
3. [Flow Map](technical/FLOW_MAP.md) — satu-satunya flow aktif: sequence bisnis + runtime/orchestrator + finalization.
4. [Webhook + Slack Daily Digest Plan](technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md) — plan fitur berikutnya.
5. [Backlog](../BACKLOG.md) — status kerja berikutnya.

Root [README](../README.md) adalah pintu masuk utama.

Untuk AI yang mau nerusin project, baca [FETCH_CONTEXT](../FETCH_CONTEXT.md) dulu.

---

## Active Docs

| Doc | Fungsi |
|---|---|
| [PRD](product/PRD.md) | Product direction, goals, classifications, roadmap |
| [TRD](technical/TRD.md) | Architecture, services, storage, deployment, security |
| [Flow Map](technical/FLOW_MAP.md) | Alur detail dari input data akun, orchestra loop, stop branches, finalizer, DB/dashboard |
| [Webhook + Slack Daily Digest Plan](technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md) | Rencana final webhook PostgreSQL queue, sequential worker, dan Slack digest jam 09:00 |
| [Tools And Algorithms](technical/TOOLS_AND_ALGORITHMS.md) | Referensi tool dan algoritma |
| [Migration v1](technical/migration_v1.sql) | Schema PostgreSQL aktual |

---

## Runtime Docs

| Doc | Fungsi |
|---|---|
| [AGENTS.md](../openclaw_workspace/AGENTS.md) | Behavior contract OpenClaw agent |
| [STANDING_ORDERS.md](../openclaw_workspace/STANDING_ORDERS.md) | Instruksi persistent runtime |
| [TOOLS.md](../openclaw_workspace/TOOLS.md) | Catatan runtime tool |
| [tool_catalog.yaml](../openclaw_workspace/config/tool_catalog.yaml) | Registry tool |
| [scoring_rules.yaml](../openclaw_workspace/config/scoring_rules.yaml) | Rules scoring/classification |

---

## Archived

Dokumen plan, review, checklist, dan flow lama dipindahkan ke [docs/archive](archive/) supaya tidak dibaca sebagai acuan aktif.

Yang termasuk archive:

- `HIGH_LEVEL_BUSINESS_FLOW.md`
- `PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md`
- `DB_AND_DASHBOARD_PLAN.md`
- `WEBHOOK_API.md`
- `PROJECT_IMPLEMENTATION_REVIEW.md`
- `BUILDING_PLAN_OPENCLAW_TELEGRAM_MVP.md`
- `GO_TRANSITION_PLAN.md`
- `GO_TRANSITION_CHECKLIST.md`
- `NEXT_LEVEL_ENRICHMENT_PLAN.md`

---

## Maintenance Rule

- Update `PRD.md` kalau arah produk berubah.
- Update `TRD.md` kalau arsitektur/komponen/deployment berubah.
- Update `FLOW_MAP.md` kalau alur runtime berubah.
- Untuk fitur baru yang belum jadi, boleh tambah plan singkat; setelah selesai, serap kembali ke PRD/TRD/FLOW_MAP.
