# Documentation Index

Dokumentasi aktif dibuat sederhana:

1. [PRD](product/PRD.md) — source of truth produk.
2. [TRD](technical/TRD.md) — source of truth teknis.
3. [Flow Map](technical/FLOW_MAP.md) — satu-satunya flow aktif: sequence bisnis + runtime/orchestrator + finalization.
4. [Webhook + Slack Daily Digest Plan](technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md) — workflow note webhook queue + Slack digest yang sudah diimplementasikan.
5. [Register Webhook API](technical/REGISTER_WEBHOOK_API.md) — kontrak REST API untuk platform register.
6. [Webhook + Slack Building Checklist](technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md) — checklist hasil implementasi, validasi, dan sisa refinement.
7. [Docker Deployment Runbook](technical/DOCKER_DEPLOYMENT_RUNBOOK.md) — satu-satunya jalur deploy production, migrasi data, cutover, dan acceptance test.
8. [Deployment Secrets Handover](technical/DEPLOYMENT_SECRETS_HANDOVER.md) — checklist penyerahan key/secrets tanpa menyimpan nilainya di Git.
9. [Owner Office Deployment Guide](operations/OWNER_OFFICE_DEPLOYMENT_GUIDE.md) — panduan pemilik sistem untuk menyiapkan, menyerahkan, dan menerima deployment.
10. [Office Docker Deployment Handover](handover/COMPANY_DETECTOR_DOCKER_DEPLOYMENT_HANDOVER.docx) — dokumen Word resmi yang diserahkan ke engineer kantor.
11. [Backlog](../BACKLOG.md) — status kerja berikutnya.
12. [Google Business Review Monitor](technical/GOOGLE_REVIEW_MONITOR.md) — fitur deterministic terisolasi untuk review Google bintang 1-3.
13. [Google Business Profile API Access Guide for Owner](handover/GOOGLE_BUSINESS_PROFILE_API_ACCESS_GUIDE_FOR_OWNER.docx) — panduan Word langkah demi langkah untuk owner profil bisnis sampai pengajuan Basic API Access berhasil.

Root [README](../README.md) adalah pintu masuk utama.

Untuk AI yang mau nerusin project, baca [FETCH_CONTEXT](../FETCH_CONTEXT.md) dulu.

---

## Active Docs

| Doc | Fungsi |
|---|---|
| [PRD](product/PRD.md) | Product direction, goals, classifications, roadmap |
| [TRD](technical/TRD.md) | Architecture, services, storage, deployment, security |
| [Flow Map](technical/FLOW_MAP.md) | Alur detail dari input data akun, orchestra loop, stop branches, finalizer, DB/dashboard |
| [Register Webhook API](technical/REGISTER_WEBHOOK_API.md) | Kontrak REST API platform register: auth, payload, response, idempotency, dan queue behavior |
| [Webhook + Slack Daily Digest Plan](technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md) | Workflow webhook PostgreSQL queue, sequential worker, Telegram delivery, dan Slack digest jam 09:00 |
| [Webhook + Slack Building Checklist](technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md) | Checklist implementasi, test, deploy, dan sisa refinement fitur webhook + Slack |
| [Deployment Secrets Handover](technical/DEPLOYMENT_SECRETS_HANDOVER.md) | Checklist key, pemilik, lokasi pemasangan, verifikasi, dan sign-off tanpa nilai secret |
| [Docker Deployment Runbook](technical/DOCKER_DEPLOYMENT_RUNBOOK.md) | Compose stack, backup/restore, deploy, Telegram acceptance test, cutover, dan rollback |
| [Owner Office Deployment Guide](operations/OWNER_OFFICE_DEPLOYMENT_GUIDE.md) | Checklist untuk pemilik sistem sebelum, selama, dan setelah handover |
| [Office Docker Deployment Handover](handover/COMPANY_DETECTOR_DOCKER_DEPLOYMENT_HANDOVER.docx) | Dokumen Word siap serah untuk engineer deployment kantor |
| [Google Business Profile API Access Guide for Owner](handover/GOOGLE_BUSINESS_PROFILE_API_ACCESS_GUIDE_FOR_OWNER.docx) | Tutorial Word untuk owner Google Business Profile: verifikasi profil, project Cloud, API pendukung, pengajuan Basic API Access, dan troubleshooting |
| [Tools And Algorithms](technical/TOOLS_AND_ALGORITHMS.md) | Referensi tool dan algoritma |
| [Token Optimization Test Log](technical/TOKEN_OPTIMIZATION_TEST_LOG.md) | Catatan AB test token, hasil gagal/ditolak, dan arah optimasi berikutnya |
| [Sales Sheet Sync Plan](technical/SALES_SHEET_SYNC_PLAN.md) | Browser Sales Sheet untuk sales follow-up, mapping field, dan fallback export |
| [Google Business Review Monitor](technical/GOOGLE_REVIEW_MONITOR.md) | Scope, isolation contract, flowchart, sequence, operations, dan acceptance fitur review monitor |
| [Migration v1](technical/migration_v1.sql) | Schema PostgreSQL awal: investigation jobs, reports, LLM calls |
| [Migration v2](technical/migration_v2_webhook_slack_queue.sql) | Schema webhook queue dan Slack daily digest tracking |

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
