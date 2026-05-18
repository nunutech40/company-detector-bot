# Flow Map

Dokumen ini adalah peta alur sistem. Tujuannya supaya flow tetap gampang dibaca walaupun nanti jumlah tool, enrichment, dan AI layer bertambah.

Gunakan dokumen ini untuk menjelaskan sistem ke orang lain dan untuk menilai impact sebelum mengubah flow.

---

## 1. Prinsip Arsitektur: Dua Layer

Sistem ini dibangun di atas dua layer yang bekerja bersama:

```text
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: DETERMINISTIK                                     │
│  Kode Go — rules, regex, scoring formula                    │
│  Cepat, predictable, auditable, tidak butuh token LLM       │
│  Dipakai untuk: validasi, routing, scoring, storage         │
│  Juga berfungsi sebagai FALLBACK MODE ketika AI tidak ada   │
└─────────────────────────────────────────────────────────────┘
         ↕  (AI memanggil tools deterministik sebagai action surface,
              tools mengembalikan evidence ke AI)
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: AI REASONING LOOP (primary mode)                  │
│  OpenClaw Agent — hypothesis, pivot, iterasi                │
│  Fleksibel, bisa reasoning dari context, tapi lebih mahal   │
│  Dipakai untuk: query selection, evidence interpretation,   │
│                 iterative discovery, ambiguity resolution   │
└─────────────────────────────────────────────────────────────┘
```

**Prinsip pemilihan layer:**

| Pertanyaan | Jawaban | Layer |
|---|---|---|
| Apakah hasilnya selalu sama untuk input yang sama? | Ya | Deterministik |
| Apakah butuh reasoning dari context? | Ya | AI |
| Apakah ini validasi format/rules? | Ya | Deterministik |
| Apakah ini memilih strategi investigasi? | Ya | AI |
| Apakah ini menghitung score dari evidence? | Ya | Deterministik |
| Apakah ini memutuskan tool mana yang paling informatif? | Ya | AI |
| Apakah hasilnya harus 100% reproducible dan auditable? | Ya | Deterministik |

**Aturan penting:**
- AI boleh memanggil tools deterministik kapan saja.
- AI boleh memanggil tools deterministik berulang kali (iterasi).
- Scoring final dan classification **selalu** deterministik — AI tidak boleh langsung membuat klaim tanpa evidence dari tools.
- AI tidak boleh mengarang evidence. Semua klaim harus berasal dari output tool.

---

## 2. Flow Keseluruhan

```text
Input (email, full_name, no_hp, brand_name)
  │
  ▼
[DETERMINISTIK] Input Normalization
  Validasi format, masking phone, ignored fields
  │
  ▼
[DETERMINISTIK] Email Intelligence
  Parse email → klasifikasi domain → hipotesis awal
  │
  ├─ invalid/disposable → [DETERMINISTIK] Scoring → Output
  │
  ▼
[AI REASONING LOOP] — primary mode
  Observe → Orient → Decide → Act → loop
  AI memanggil Go tools sebagai action surface:
  ┌──────────────────────────────────────────────────────────┐
  │  Tool Catalog (bisa dipanggil AI kapan saja):            │
  │                                                          │
  │  Go Tools (deterministik, selalu tersedia):              │
  │    company_check  — baseline pipeline lengkap            │
  │    domaincheck    — DNS + HTTP check                     │
  │    crawler        — lightweight website crawl            │
  │    scraper        — HTML-to-text scraper                 │
  │    search cascade — Google CSE → Brave → Bing → DDG      │
  │                                                          │
  │  OpenClaw Built-in:                                      │
  │    web_fetch      — fetch + extract URL content          │
  │    web_search     — OpenClaw search (berbeda angle)      │
  │    browser        — JS-heavy fallback                    │
  │                                                          │
  │  (Phase B+) social_link_extractor, role_signal_extractor │
  └──────────────────────────────────────────────────────────┘
  Loop sampai: confidence >= 75 ATAU budget habis
  │
  ▼
[DETERMINISTIK] Scoring Engine
  Hitung confidence dari semua evidence yang dikumpulkan AI
  base_score + sum(evidence_delta) → classification
  │
  ▼
[DETERMINISTIK] Report + Evidence Store + Slack/Telegram
  │
  ├─ [DETERMINISTIK] Evidence Store (--save)
  │
  └─ [DETERMINISTIK] Slack Reporter (--send-slack)

─────────────────────────────────────────────────────────────
[FALLBACK MODE] — ketika AI tidak tersedia
  Go pipeline jalan dengan simple fallback query
  Report minimal: tools used/failed/skipped + scoring summary
  Note: "AI Reasoning tidak aktif — fallback ke deterministik pipeline"
─────────────────────────────────────────────────────────────
```

---

## 3. AI Reasoning Loop: Cara Kerja

AI bekerja seperti investigator — bukan pipeline kaku. Setiap langkah diputuskan berdasarkan temuan sebelumnya.

```text
[AI] Observe: baca email facts + hipotesis awal dari emailintel
[AI] Orient:  "nawaystore" → kemungkinan brand, bukan nama orang
[AI] Decide:  query "nawaystore" store OR tokopedia OR instagram
[AI] Act:     panggil web_search atau search cascade

[AI] Observe: baca hasil tool
[AI] Orient:  "nemu instagram nawaystore, ada nama owner Tatak Subekti"
[AI] Decide:  cari konfirmasi → web_fetch instagram URL
[AI] Act:     panggil web_fetch

... loop sampai confidence cukup atau budget habis ...

Stop condition:
  - confidence >= 75 AND 2+ independent evidence sources
  - budget habis (max 10 tool calls)
  - 3 consecutive tool calls tidak menghasilkan informasi baru
  - classification sudah jelas (suspicious_or_invalid)
```

**Two-phase investigation (AGENTS.md Phase A):**

```text
Phase 1: Business or Personal?
  → Tentukan classification utama
  → Kumpulkan semua data bisnis yang tersedia

Phase 2: Business Relationship Discovery (jika Phase 1 = personal/unknown)
  → Cari apakah orang punya relasi bisnis
  → Social media, marketplace, role evidence, phone confirmation
```

**Query selection:** AI yang memilih query berdasarkan context. Go hanya menyediakan simple fallback query (inline di orchestrator) untuk fallback mode.

---

## 4. Fallback Mode: Deterministik Penuh

Ketika AI tidak tersedia (quota habis, model error), Go pipeline jalan sendiri.

```text
Go company-check [DETERMINISTIK orchestrator]
  │
  ├─ emailintel [ALGO]
  ├─ domaincheck [TOOL DNS+HTTP]  ← hanya jika custom domain
  ├─ crawler [TOOL HTTP+ALGO]     ← hanya jika custom domain
  ├─ fallback query [ALGO inline] ← simple query, AI handle query selection di primary mode
  ├─ search cascade [TOOL]        ← Google CSE → Brave → Bing → DDG
  ├─ scraper [TOOL HTTP+ALGO]     ← hanya jika ada URL aktif
  ├─ scoring [ALGO]
  ├─ report [ALGO — fallback mode only]
  ├─ evidence store [ALGO]        ← jika --save
  └─ slack [TOOL]                 ← jika --send-slack
```

Report fallback menampilkan:
- `[FALLBACK MODE — AI reasoning tidak aktif]`
- Tools dijalankan, gagal, dilewati
- Evidence count
- Scoring summary deterministik

**Kelebihan:** cepat, reproducible, auditable, tidak butuh token LLM.

**Keterbatasan:** tidak bisa pivot strategi. Contoh: `nawaystore@yahoo.com` — local part `nawaystore` adalah brand hint yang kuat, tapi fallback mode tidak bisa mendeteksi itu dan mengubah strategi pencarian.

---

## 5. Decision Points

### D1: Input valid?

Owner: `[DETERMINISTIK]` emailintel

```text
invalid/disposable → suspicious_or_invalid, stop investigasi
valid → lanjut ke AI reasoning loop (atau fallback mode)
```

### D2: Free email atau custom domain?

Owner: `[DETERMINISTIK]` emailintel → disampaikan ke AI sebagai hipotesis awal

```text
custom domain → AI prioritaskan domain_checker + crawler
free email    → AI prioritaskan pencarian publik dari local-part/nama/brand
```

### D3: Evidence cukup untuk stop?

Owner: `[AI]` reasoning loop

```text
confidence >= 75 AND 2+ independent sources → stop, ke scoring
budget habis → stop, ke scoring dengan inconclusive
3 consecutive tool calls tidak menghasilkan info baru → stop
tidak ada jalur baru → stop
```

### D4: Tool berhasil atau gagal?

Owner: `[DETERMINISTIK]` orchestrator (fallback) / `[AI]` (primary mode)

```text
success → tools_used
failure → tool_errors (bukan evidence)
not applicable → tools_skipped
```

### D5: Classification apa?

Owner: `[DETERMINISTIK]` scoring engine

```text
invalid/disposable → suspicious_or_invalid
free email + score < 45 → likely_personal_email
free email + score >= 45 → unknown_needs_more_evidence
custom domain + website active → possible_company_affiliated
custom domain + score >= 45 → possible_company_affiliated
otherwise → unknown_needs_more_evidence
```

### D6: Kirim Slack?

Current MVP: kirim untuk semua classification, selama Slack env configured dan `--send-slack` diberikan.

Future (setelah DB): personal/unknown → DB only; company/high-value → Telegram + Slack.

---

## 6. Data Flow

### Input

```json
{
  "email": "nawaystore@yahoo.com",
  "full_name": "Tatak Subekti",
  "no_hp": "08123456789",
  "brand_name": ""
}
```

Field rules:
- `email` — required, primary routing signal
- `full_name` — optional, identity hint untuk pencarian publik
- `brand_name` — optional, strongest non-email business hint
- `no_hp` — optional, confirmation only (tidak untuk public search)
- `username` — tidak trusted, diabaikan

### Evidence item

```json
{
  "source_type": "company_website",
  "source_url": "https://komerce.id/about",
  "claim": "Website active with business signals.",
  "value": "Komerce - End-to-end e-commerce enabler",
  "reliability": "medium",
  "confidence_delta": 20
}
```

Anti-hallucination rule: scoring engine menolak evidence tanpa `source_url`. Setiap klaim AI harus punya source URL dari tool output.

### Output MVP (fallback mode)

```json
{
  "classification": "possible_company_affiliated",
  "confidence_score": 100,
  "automation_action": "route_company_associated",
  "tools_used": [],
  "tools_skipped": [],
  "tool_errors": [],
  "evidence": [],
  "telegram_report": "..."
}
```

### Output Phase A+ (tambahan dari AI reasoning)

```json
{
  "company_profile": {},
  "person_profile": {},
  "business_relationship": "founder_or_owner_candidate",
  "investigation_rounds": 3,
  "ai_reasoning_log": [],
  "phone_confirmation": {},
  "social_media": {},
  "location": {}
}
```

---

## 7. Cara Mengubah Flow dengan Aman

Sebelum mengubah tool deterministik:

1. Cek di [Tools and Algorithms Reference](TOOLS_AND_ALGORITHMS.md).
2. Cek decision point mana yang terpengaruh di dokumen ini.
3. Cek apakah scoring perlu diupdate.
4. Update docs dan tests bersamaan.

Sebelum menambah tool ke AI catalog:

1. Pastikan tool punya contract yang jelas (input/output/evidence type/reliability/failure behavior).
2. Pastikan scoring tetap deterministik — AI hanya mengumpulkan evidence, tidak membuat classification sendiri.
3. Tambahkan stop condition yang eksplisit (confidence threshold, max rounds, budget).
4. Catat di report step mana yang diputuskan AI vs deterministik.
5. Update `tool_catalog.yaml` dan `TOOLS.md`.

Contoh perubahan aman:
- Tambah free email domain baru di emailintel
- Tambah candidate crawl path di crawler
- Tambah evidence type baru dari search results
- Tambah tool baru ke AI catalog dengan contract jelas

Contoh perubahan berisiko:
- Naikkan confidence delta tanpa test
- Biarkan AI langsung set classification tanpa scoring engine
- Tidak ada stop condition di AI loop
- Klaim founder/owner dari satu snippet lemah tanpa cross-check

---

## 8. Roadmap Layer

```text
Sekarang (MVP + Phase A)
  Layer 1: Deterministik (normalization, scoring, storage, delivery, fallback mode)
  Layer 2: AI reasoning loop di evidence collection (AGENTS.md Phase A sudah siap)
  Status: AGENTS.md sudah Phase A; belum ditest end-to-end dari Telegram
  Prerequisite: Google CSE API key (gratis) atau Brave Search API

Phase B: Postgres + Queue
  Masuk setelah AI loop terbukti menghasilkan evidence lebih kaya
  Layer 1: Deterministik + DB writer
  Layer 2: AI loop dengan evidence persistence

Phase C: Tool Catalog Expansion
  social_link_extractor, role_signal_extractor, marketplace_search
  AI punya lebih banyak jalur, lebih sedikit stuck

Phase D: Multi-Agent
  Masuk setelah volume naik atau investigasi terlalu kompleks untuk satu agent
  Layer 1: Deterministik (scoring, storage tetap terpusat)
  Layer 2: Multiple AI agents paralel untuk evidence collection
  Rule: sub-agents collect evidence, scoring dan final claims tetap terpusat
```

---

## 9. Document Map

- [Root README](../../README.md): project entry point.
- [Docs Index](../README.md): reading order and documentation map.
- [High Level Business Flow](../product/HIGH_LEVEL_BUSINESS_FLOW.md): business-level current vs level-2 flow.
- [Flow Map](FLOW_MAP.md): arsitektur dua layer dan roadmap.
- [Tools and Algorithms Reference](TOOLS_AND_ALGORITHMS.md): kamus tool dan algoritma.
- [Next Level Enrichment Plan](../product/NEXT_LEVEL_ENRICHMENT_PLAN.md): rencana enrichment.
- [Product Workflow and Storage Plan](../product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md): Postgres, Slack, dashboard.
- [Backlog](../../BACKLOG.md): implementation tasks.
- [OpenClaw Agent Prompt](../../openclaw_workspace/AGENTS.md): runtime behavior contract (Phase A).
- [Tool Notes](../../openclaw_workspace/TOOLS.md): runtime tool notes.
- [Tool Catalog](../../openclaw_workspace/config/tool_catalog.yaml): tool registry.
- [Scoring Rules](../../openclaw_workspace/config/scoring_rules.yaml): scoring reference.
