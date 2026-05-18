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
└─────────────────────────────────────────────────────────────┘
         ↕  (AI memanggil tools deterministik,
              tools mengembalikan evidence ke AI)
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: AI REASONING                                      │
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
[DETERMINISTIK] Routing Decision
  custom domain → jalur domain/website
  free email    → jalur pencarian publik
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│  EVIDENCE COLLECTION                                        │
│                                                             │
│  MVP sekarang: [DETERMINISTIK] — urutan tetap               │
│  Phase A nanti: [AI] — reasoning loop, iteratif             │
│                                                             │
│  Tools yang tersedia (bisa dipanggil deterministik/AI):     │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ domain_checker   │  │ website_crawler  │                │
│  │ [TOOL DNS+HTTP]  │  │ [TOOL HTTP+ALGO] │                │
│  └──────────────────┘  └──────────────────┘                │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ fallback query   │  │ search (DDG/Brave)│               │
│  │ [ALGO inline]    │  │ [TOOL]           │                │
│  │ (AI handles      │  │                  │                │
│  │  query selection │  │                  │                │
│  │  in Phase A)     │  │                  │                │
│  └──────────────────┘  └──────────────────┘                │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ free_scraper     │  │ web_fetch        │                │
│  │ [TOOL HTTP+ALGO] │  │ [TOOL]           │                │
│  └──────────────────┘  └──────────────────┘                │
│  ┌──────────────────────────────────────────┐              │
│  │ (Phase A+) social_extractor, role_signal │              │
│  │ profile_search, enrichment_api           │              │
│  └──────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
[DETERMINISTIK] Scoring Engine
  Hitung confidence dari semua evidence
  base_score + sum(evidence_delta) → classification
  │
  ▼
[DETERMINISTIK] Report Formatter
  Buat laporan dengan step-by-step investigasi
  Label [ALGO]/[TOOL]/[AI] per step
  │
  ├─ [DETERMINISTIK] Evidence Store (--save)
  │
  └─ [DETERMINISTIK] Slack Reporter (--send-slack)
```

---

## 3. MVP Sekarang: Deterministik Penuh

Flow saat ini adalah **deterministik penuh** — tidak ada AI di dalam loop investigasi. OpenClaw hanya berperan sebagai gateway.

> **Note:** Query builder (`serp_query_builder`) sudah dihapus sebagai package terpisah. Query selection sekarang dilakukan oleh AI reasoning loop (Phase A). Go hanya menyediakan simple fallback query yang di-inline di orchestrator.
>
> Report narasi investigasi step-by-step juga sudah dihapus dari Go. Go hanya menghasilkan fallback report (tools used/failed/skipped + scoring summary) ketika AI tidak tersedia. Di Phase A, AI yang menghasilkan narasi investigasi.

```text
Telegram input
  │
  ▼
OpenClaw Gateway [AI sebagai gateway saja]
  │  panggil script
  ▼
Go company-check [DETERMINISTIK orchestrator]
  │
  ├─ emailintel [ALGO]
  ├─ domaincheck [TOOL DNS+HTTP]  ← hanya jika custom domain
  ├─ crawler [TOOL HTTP+ALGO]     ← hanya jika custom domain
  ├─ fallback query [ALGO inline] ← simple query, AI handle query selection di Phase A
  ├─ search/DDG [TOOL]
  ├─ scraper [TOOL HTTP+ALGO]     ← hanya jika ada URL aktif
  ├─ scoring [ALGO]
  ├─ report [ALGO — fallback mode only, AI handle narasi di Phase A]
  ├─ evidence store [ALGO]        ← jika --save
  └─ slack [TOOL]                 ← jika --send-slack
```

**Kelebihan:** cepat, reproducible, auditable, tidak butuh token LLM.

**Keterbatasan:** tidak bisa pivot strategi. Contoh: `nawaystore@yahoo.com` — local part `nawaystore` adalah brand hint yang kuat, tapi sistem deterministik tidak bisa mendeteksi itu dan mengubah strategi pencarian.

---

## 4. Phase A: AI Reasoning Loop (Next Step)

AI masuk ke dalam loop evidence collection. Deterministik tetap dipakai untuk validasi, scoring, dan storage.

```text
Telegram input
  │
  ▼
OpenClaw Gateway
  │
  ▼
[DETERMINISTIK] Input Normalization + Email Intelligence
  → hasilkan: email facts, hipotesis awal, routing signal
  │
  ▼
[AI] Orchestrator — reasoning loop
  │
  │  Observe: baca email facts + hipotesis awal
  │  Orient:  "nawaystore" → kemungkinan brand, bukan nama orang
  │  Decide:  query "nawaystore" store OR tokopedia OR instagram
  │  Act:     panggil search tool
  │
  ├─ panggil [DETERMINISTIK] tools sesuai kebutuhan:
  │    search("nawaystore tokopedia OR instagram")
  │    web_fetch(url_yang_ditemukan)
  │    scraper(halaman_about)
  │    domain_checker(domain_kandidat)
  │    query_builder(identity_baru_yang_ditemukan)
  │
  │  Observe: baca hasil tool
  │  Orient:  "nemu instagram nawaystore, ada nama owner Tatak Subekti"
  │  Decide:  cari konfirmasi → search "Tatak Subekti Naway Store"
  │  Act:     panggil search tool lagi
  │
  │  ... loop sampai confidence cukup atau budget habis ...
  │
  │  Stop condition:
  │    - confidence >= threshold
  │    - evidence sudah cukup kuat
  │    - retry/cost budget habis
  │    - tidak ada tool baru yang bisa menambah informasi
  │
  ▼
[DETERMINISTIK] Scoring Engine
  Hitung dari semua evidence yang dikumpulkan AI
  │
  ▼
[DETERMINISTIK] Report + Storage + Slack
```

**Yang berubah di Phase A:**
- AI memilih query, bukan fallback query builder
- AI bisa iterasi dari temuan (round 2, round 3)
- AI bisa detect brand hint dari local-part email
- AI menghasilkan narasi investigasi langsung (bukan Go report formatter)
- Scoring dan classification tetap deterministik

**Yang tidak berubah:**
- Input normalization tetap deterministik
- Scoring formula tetap deterministik
- Evidence harus dari tool output, bukan AI reasoning langsung
- Storage dan delivery tetap deterministik
- Go report formatter tetap ada sebagai fallback ketika AI tidak tersedia

**Prerequisite Phase A:**
- Brave Search API aktif (DDG terlalu fragile untuk AI loop)
- Tools Go di-expose sebagai callable functions terpisah

---

## 5. Decision Points

### D1: Input valid?

Owner: `[DETERMINISTIK]` emailintel

```text
invalid/disposable → suspicious_or_invalid, stop investigasi
valid → lanjut ke routing
```

### D2: Free email atau custom domain?

Owner: `[DETERMINISTIK]` emailintel

```text
custom domain → jalankan domain_checker + crawler
free email    → skip domain tools, ke pencarian publik
```

### D3: Evidence cukup untuk stop?

Owner MVP: `[DETERMINISTIK]` — tidak ada early stop, semua step selalu jalan

Owner Phase A: `[AI]` — AI decide apakah perlu lanjut atau sudah cukup

```text
confidence >= threshold AND evidence kuat → stop, ke scoring
budget habis → stop, ke scoring dengan inconclusive
ada tool baru yang informatif → lanjut iterasi
```

### D4: Tool berhasil atau gagal?

Owner: `[DETERMINISTIK]` orchestrator

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

Current MVP: kirim untuk semua classification, selama Slack env configured.

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
- `no_hp` — optional, internal matching/dedup only, tidak untuk public search
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

### Output MVP

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

### Output Phase A+ (tambahan)

```json
{
  "company_profile": {},
  "person_profile": {},
  "business_relationship": "founder_or_owner_candidate",
  "investigation_rounds": 3,
  "ai_reasoning_log": []
}
```

---

## 7. Cara Mengubah Flow dengan Aman

Sebelum mengubah tool deterministik:

1. Cek di [Tools and Algorithms Reference](TOOLS_AND_ALGORITHMS.md).
2. Cek decision point mana yang terpengaruh di dokumen ini.
3. Cek apakah scoring perlu diupdate.
4. Update docs dan tests bersamaan.

Sebelum menambah AI step:

1. Pastikan tool yang akan dipanggil AI sudah punya contract yang jelas (input/output/evidence type).
2. Pastikan scoring tetap deterministik — AI hanya mengumpulkan evidence, tidak membuat classification sendiri.
3. Tambahkan stop condition yang eksplisit (confidence threshold, max rounds, budget).
4. Catat di report step mana yang diputuskan AI vs deterministik.

Contoh perubahan aman:
- Tambah free email domain baru di emailintel
- Tambah candidate crawl path di crawler
- Tambah evidence type baru dari search results

Contoh perubahan berisiko:
- Naikkan confidence delta tanpa test
- Biarkan AI langsung set classification tanpa scoring engine
- Tidak ada stop condition di AI loop
- Klaim founder/owner dari satu snippet lemah

---

## 8. Roadmap Layer

```text
Sekarang (MVP)
  Layer 1: Deterministik penuh
  Layer 2: AI sebagai gateway saja (terima Telegram → panggil script)

Phase A: Single Agent + Reasoning Loop
  Layer 1: Deterministik (normalization, scoring, storage, delivery)
  Layer 2: AI reasoning loop di evidence collection
  Prerequisite: Brave Search API, tools exposed as callable functions

Phase B: Postgres + Queue
  Masuk setelah AI loop terbukti menghasilkan evidence lebih kaya
  Layer 1: Deterministik + DB writer
  Layer 2: AI loop dengan evidence persistence

Phase C: Multi-Agent
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
- [OpenClaw Agent Prompt](../../openclaw_workspace/AGENTS.md): runtime behavior contract.
- [Tool Notes](../../openclaw_workspace/TOOLS.md): runtime tool notes.
- [Tool Catalog](../../openclaw_workspace/config/tool_catalog.yaml): tool registry.
- [Scoring Rules](../../openclaw_workspace/config/scoring_rules.yaml): scoring reference.
