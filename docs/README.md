# Documentation Index

Dokumentasi project ini dibagi supaya gampang dibaca dan gampang diubah. Root `README.md` hanya pintu masuk. Detail produk, teknis, operasi, dan review disimpan di folder masing-masing.

## Cara Baca Paling Enak

Untuk paham project dari nol:

1. [High Level Business Flow](product/HIGH_LEVEL_BUSINESS_FLOW.md)
   Mulai dari sini. Ini menjawab: input masuk dari mana, diproses lewat logika apa, dan output akhirnya apa.

2. [Flow Map](technical/FLOW_MAP.md)
   Baca setelah paham gambar besar. Ini menjelaskan alur runtime, branching, decision point, dan batas perubahan supaya tidak menyenggol semua hal.

3. [Tools and Algorithms Reference](technical/TOOLS_AND_ALGORITHMS.md)
   Baca kalau mau tahu script/tool mana melakukan apa, algoritmanya gimana, dan impact kalau satu bagian diubah.

4. [Project Implementation Review](reviews/PROJECT_IMPLEMENTATION_REVIEW.md)
   Baca kalau mau tahu project sudah sampai mana dibanding PRD/TRD/plan, dan gap yang masih ada.

5. [Backlog](../BACKLOG.md)
   Baca kalau mau menentukan kerja berikutnya.

## Product Docs

- [High Level Business Flow](product/HIGH_LEVEL_BUSINESS_FLOW.md)
  Peta bisnis/logika utama current MVP vs Level 2. Berisi 2 flowchart dan 2 sequence diagram.

- [PRD](product/PRD.md)
  Product requirement: masalah, goal, classification model, scoring rubric, report expectation, dan contoh skenario.

- [Next Level Enrichment Plan](product/NEXT_LEVEL_ENRICHMENT_PLAN.md)
  Rencana email-first enrichment: company profile, social footprint, dan personal-to-business discovery.

- [Product Workflow and Storage Plan](product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md)
  Rencana Postgres, Slack alert, dashboard, dan lifecycle data setelah MVP.

## Technical Docs

- [TRD](technical/TRD.md)
  Target architecture teknis: worker, queue, Postgres evidence store, API contract, deployment, security, observability.

- [Flow Map](technical/FLOW_MAP.md)
  Peta alur runtime, decision points, data flow, dan future multi-agent map.

- [Tools and Algorithms Reference](technical/TOOLS_AND_ALGORITHMS.md)
  Kamus tool/script, algoritma, scoring behavior, config, dan change impact map.

## Operations Docs

- [Building Plan OpenClaw Telegram MVP](operations/BUILDING_PLAN_OPENCLAW_TELEGRAM_MVP.md)
  Catatan build dari VPS setup, OpenClaw install, Telegram setup, pairing, sampai testing.

## Reviews

- [Project Implementation Review](reviews/PROJECT_IMPLEMENTATION_REVIEW.md)
  Review status implementasi terhadap PRD, TRD, building plan, next-level enrichment, dan storage/dashboard plan.

## Runtime Docs In OpenClaw Workspace

- [OpenClaw Agent Prompt](../openclaw_workspace/AGENTS.md)
  Behavior contract yang dipakai agent Telegram.

- [Tool Notes](../openclaw_workspace/TOOLS.md)
  Status runtime tool, availability, dan operational rules.

- [Tool Catalog](../openclaw_workspace/config/tool_catalog.yaml)
  Registry tools yang enabled/disabled/optional.

- [Scoring Rules](../openclaw_workspace/config/scoring_rules.yaml)
  Catatan classification dan evidence weighting.

## Apa Yang Redundant Dan Sudah Dipisah

- Gambar besar bisnis/logika utama ada di `product/HIGH_LEVEL_BUSINESS_FLOW.md`.
- Detail runtime dan branching ada di `technical/FLOW_MAP.md`.
- Detail algoritma/script ada di `technical/TOOLS_AND_ALGORITHMS.md`.
- Rencana masa depan produk ada di `product/NEXT_LEVEL_ENRICHMENT_PLAN.md`.
- Rencana storage/Slack/dashboard ada di `product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md`.
- Status gap terhadap plan ada di `reviews/PROJECT_IMPLEMENTATION_REVIEW.md`.

Kalau ada feature baru, update dokumen sesuai rumahnya. Jangan menaruh semua hal baru di README.
