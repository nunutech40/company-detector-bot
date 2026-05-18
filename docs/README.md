# Documentation Index

Dokumentasi project ini dibagi supaya gampang dibaca dan gampang diubah. Root `README.md` hanya pintu masuk. Detail produk, teknis, operasi, dan review disimpan di folder masing-masing.

## Cara Baca Paling Enak

Untuk paham project dari nol:

1. [High Level Business Flow](product/HIGH_LEVEL_BUSINESS_FLOW.md)
   Mulai dari sini. Gambaran besar: input dari mana, dua layer arsitektur (deterministik + AI), output akhirnya apa.

2. [Flow Map](technical/FLOW_MAP.md)
   Baca setelah paham gambar besar. Ini menjelaskan arsitektur dua layer secara detail: kapan deterministik, kapan AI, bagaimana fallback bekerja, dan roadmap Phase A–E.

3. [Tools and Algorithms Reference](technical/TOOLS_AND_ALGORITHMS.md)
   Baca kalau mau tahu tool/algoritma mana melakukan apa, dan mana yang bisa dipanggil AI vs yang selalu deterministik.

4. [Go Transition Plan](technical/GO_TRANSITION_PLAN.md)
   Baca kalau mau memahami status transisi dari Node.js prototype ke Go production — Go sudah deployed di VPS.

4b. [Go Transition Execution Checklist](technical/GO_TRANSITION_CHECKLIST.md)
   Checklist granular status transisi Go.

5. [Project Implementation Review](reviews/PROJECT_IMPLEMENTATION_REVIEW.md)
   Baca kalau mau tahu project sudah sampai mana, gap yang masih ada, dan next priority.

6. [Backlog](../BACKLOG.md)
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
  Target architecture teknis: arsitektur dua layer (deterministik + AI reasoning loop), tool catalog, Postgres, deployment, security, observability, roadmap Phase A–E.

- [Flow Map](technical/FLOW_MAP.md)
  Arsitektur dua layer: deterministik sebagai fondasi + AI reasoning loop sebagai primary mode. Kapan pakai masing-masing, bagaimana fallback bekerja, roadmap Phase A–E.

- [Tools and Algorithms Reference](technical/TOOLS_AND_ALGORITHMS.md)
  Kamus tool/script, algoritma, scoring behavior, config, dan change impact map.

- [Go Transition Plan](technical/GO_TRANSITION_PLAN.md)
  Building plan transisi dari Node.js reference prototype menuju Go production implementation.

- [Go Transition Execution Checklist](technical/GO_TRANSITION_CHECKLIST.md)
  Checklist granular supaya transisi Go bisa dikerjakan agent step-by-step sampai testing/cutover selesai.

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
- Rencana porting production Go ada di `technical/GO_TRANSITION_PLAN.md`.
- Rencana masa depan produk ada di `product/NEXT_LEVEL_ENRICHMENT_PLAN.md`.
- Rencana storage/Slack/dashboard ada di `product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md`.
- Status gap terhadap plan ada di `reviews/PROJECT_IMPLEMENTATION_REVIEW.md`.

Kalau ada feature baru, update dokumen sesuai rumahnya. Jangan menaruh semua hal baru di README.
