# Building Plan — AI Company Detection Agent

**Target hari ini:** jalankan MVP paling kecil dari VPS: user kirim email lewat Telegram → OpenClaw/agent menerima pesan → agent mengecek tool mana yang bisa dipakai → menjalankan investigasi semampunya → mengirim balik laporan ke Telegram berisi proses yang berhasil, gagal, skipped, dan ongoing/waiting.

**Dokumen turunan:** PRD Deteksi Perusahaan v6 + TRD AI Company Detection Agent.

---

## 0. Definisi MVP Hari Ini

### Goal

Membuktikan alur end-to-end paling awal:

```text
Telegram user
  ↓
Telegram Bot
  ↓
OpenClaw Gateway di VPS
  ↓
AI Company Detection Agent
  ↓
Tool availability check
  ↓
Investigasi email/domain/web semampunya
  ↓
Report balik ke Telegram
```

### Input minimal

User cukup kirim:

```text
/check alex@acme.ai
```

atau:

```text
Cek email ini: alex@acme.ai
```

### Output minimal

Agent harus membalas Telegram dengan format:

```text
🔎 Company Detection Test Report

Input:
Email: alex@acme.ai

Kesimpulan sementara:
...

Proses yang berhasil:
✅ Email parsed
✅ Domain extracted
✅ Free email check completed
✅ Website/domain check completed

Proses yang gagal:
❌ Firecrawl unavailable: API key not configured

Proses yang dilewati:
⏭ Enrichment API skipped: disabled_waiting_budget
⏭ Browser skipped: not needed for today MVP

Status tool:
- web_search: available / unavailable
- web_fetch: available / unavailable
- firecrawl: disabled
- enrichment_api: disabled

Rekomendasi:
...
```

---

## 1. Prinsip Build

- [ ] Mulai dari VPS dan runtime dulu, bukan langsung agent logic.
- [ ] Hari ini fokus ke Telegram-only, belum perlu Slack.
- [ ] Tools yang belum ada tetap dicatat sebagai `disabled`, `not_configured`, `waiting_budget`, atau `skipped`.
- [ ] Agent tidak boleh gagal total hanya karena satu tool belum tersedia.
- [ ] Semua proses harus dilaporkan ke user Telegram.
- [ ] Jangan bikin flow kaku A → B → C. Agent boleh memilih tool berdasarkan kecurigaan, tapi untuk MVP hari ini minimal harus menjalankan health check tools dulu.

---

# PHASE 0 — Persiapan VPS

## 0.1 Pilih VPS

Rekomendasi minimal untuk eksperimen:

- [ ] Ubuntu 22.04 atau 24.04 LTS
- [ ] 2 vCPU
- [ ] 4 GB RAM minimum
- [ ] 40 GB storage
- [ ] Public IPv4
- [ ] Akses SSH root/sudo

Untuk murah/MVP:

- [ ] IDCloudHost / DigitalOcean / Hetzner / VPS lain
- [ ] Region bebas, tapi pilih yang stabil

## 0.2 Login ke VPS

```bash
ssh root@YOUR_SERVER_IP
```

Kalau pakai user non-root:

```bash
ssh ubuntu@YOUR_SERVER_IP
```

## 0.3 Update server

```bash
apt update && apt upgrade -y
apt install -y curl wget git unzip ca-certificates gnupg lsb-release ufw htop nano jq
```

Checklist:

- [ ] Server bisa diakses via SSH
- [ ] Package update selesai
- [ ] `curl`, `git`, `jq` terinstall

## 0.4 Buat user deploy

```bash
adduser deploy
usermod -aG sudo deploy
su - deploy
```

Checklist:

- [ ] User `deploy` dibuat
- [ ] User `deploy` punya sudo
- [ ] Operasi berikutnya pakai user `deploy`

## 0.5 Setup firewall dasar

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status
```

Untuk MVP Telegram long polling, tidak wajib expose port OpenClaw ke publik. Port dashboard bisa diakses via SSH tunnel.

Checklist:

- [ ] SSH tetap bisa masuk
- [ ] Firewall aktif
- [ ] Port publik dibatasi

---

# PHASE 1 — Install Runtime Dasar

## 1.1 Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

Test:

```bash
docker --version
docker run hello-world
```

Checklist:

- [ ] Docker terinstall
- [ ] User bisa menjalankan `docker` tanpa sudo
- [ ] `hello-world` sukses

## 1.2 Install Docker Compose plugin

```bash
docker compose version
```

Kalau belum ada:

```bash
sudo apt install -y docker-compose-plugin
```

Checklist:

- [ ] `docker compose version` berhasil

## 1.3 Install Node.js

OpenClaw docs merekomendasikan Node.js 24, atau Node 22.14+ untuk compatibility.

Install via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

Checklist:

- [ ] Node.js 24 terinstall
- [ ] `node --version` OK
- [ ] `npm --version` OK

---

# PHASE 2 — Install OpenClaw di VPS

## 2.1 Install OpenClaw

Pakai installer resmi:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Refresh shell jika perlu:

```bash
source ~/.bashrc
```

Test:

```bash
openclaw --version
```

Checklist:

- [ ] OpenClaw CLI terinstall
- [ ] `openclaw --version` berhasil

## 2.2 Run onboarding

```bash
openclaw onboard --install-daemon
```

Saat onboarding:

- [ ] Pilih model provider yang punya API key
- [ ] Masukkan API key
- [ ] Configure Gateway
- [ ] Install daemon/service kalau tersedia

Checklist:

- [ ] Onboarding selesai
- [ ] Model provider tersimpan
- [ ] Gateway config dibuat

## 2.3 Start / cek Gateway

```bash
openclaw gateway status
```

Expected:

```text
Gateway listening on port 18789
```

Kalau belum jalan:

```bash
openclaw gateway
```

Checklist:

- [ ] Gateway jalan
- [ ] Port 18789 aktif secara lokal

## 2.4 Cek dashboard via SSH tunnel

Di laptop lokal:

```bash
ssh -L 18789:localhost:18789 deploy@YOUR_SERVER_IP
```

Lalu buka browser lokal:

```text
http://localhost:18789
```

Checklist:

- [ ] Dashboard bisa dibuka via SSH tunnel
- [ ] Bisa kirim chat test dari dashboard
- [ ] AI bisa membalas

---

# PHASE 3 — Setup Telegram Bot

## 3.1 Buat bot via BotFather

Di Telegram:

- [ ] Chat `@BotFather`
- [ ] Jalankan `/newbot`
- [ ] Ikuti prompt nama bot
- [ ] Simpan bot token

Contoh token:

```text
123456789:ABCxxxxxxxxxxxxxxxx
```

Jangan commit token ke repo.

## 3.2 Set environment variable

Di VPS:

```bash
mkdir -p ~/.openclaw
nano ~/.openclaw/.env
```

Isi:

```env
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
```

Checklist:

- [ ] Token Telegram tersimpan di env/config
- [ ] Token tidak ditulis di Slack/Telegram/repo

## 3.3 Configure Telegram channel di OpenClaw

Konsep config:

```js
{
  channels: {
    telegram: {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      dmPolicy: "pairing",
      groups: { "*": { requireMention: true } }
    }
  }
}
```

Catatan:

- Untuk hari ini gunakan DM dulu.
- `dmPolicy: pairing` aman untuk awal.
- Grup bisa nanti.

Checklist:

- [ ] Telegram channel enabled
- [ ] `dmPolicy` diset ke `pairing`
- [ ] Gateway restart setelah config berubah

## 3.4 Restart Gateway

```bash
openclaw gateway restart
```

atau jika jalan foreground:

```bash
openclaw gateway
```

Checklist:

- [ ] Gateway restart tanpa error
- [ ] Tidak ada error Telegram token

## 3.5 Pairing DM Telegram

Di Telegram, kirim pesan pertama ke bot.

Di VPS:

```bash
openclaw pairing list telegram
openclaw pairing approve telegram <CODE>
```

Checklist:

- [ ] Bot menerima DM
- [ ] Pairing code muncul
- [ ] Pairing approved
- [ ] Bot bisa membalas DM

---

# PHASE 4 — Test OpenClaw dari Telegram

## 4.1 Test chat biasa

Kirim ke bot:

```text
Halo, kamu online?
```

Expected:

- [ ] Bot membalas
- [ ] Response masuk dari OpenClaw
- [ ] Tidak perlu command khusus dulu

## 4.2 Test format tugas

Kirim:

```text
/check alex@acme.ai
```

Kalau command belum dibuat, kirim prompt natural:

```text
Tolong cek email alex@acme.ai. Jalankan company detection test. Cek tools mana yang bisa dipakai, lakukan investigasi semampunya, lalu laporkan proses berhasil, gagal, skipped, dan hasil akhirnya.
```

Checklist:

- [ ] Agent memahami tugas
- [ ] Agent tidak meminta banyak klarifikasi
- [ ] Agent mencoba proses yang tersedia
- [ ] Agent membalas report ke Telegram

---

# PHASE 5 — Buat Workspace Project

## 5.1 Struktur folder

```bash
mkdir -p ~/company-detection-agent
cd ~/company-detection-agent
mkdir -p config logs scripts reports evidence
```

Struktur:

```text
company-detection-agent/
  config/
    tool_catalog.yaml
    scoring_rules.yaml
    prompts.md
  scripts/
    email_intelligence.js
    domain_checker.js
  evidence/
  reports/
  logs/
```

Checklist:

- [ ] Folder project dibuat
- [ ] Config awal tersedia
- [ ] Evidence/report punya lokasi simpan

## 5.2 Tool availability matrix

Buat file:

```bash
nano config/tool_catalog.yaml
```

Isi awal:

```yaml
tools:
  email_intelligence:
    status: enabled
    type: custom_script
    cost: free
    priority: mvp

  domain_checker:
    status: enabled
    type: custom_script
    cost: free
    priority: mvp

  web_search:
    status: check_runtime
    type: openclaw_builtin
    cost: depends_provider
    priority: mvp

  web_fetch:
    status: check_runtime
    type: openclaw_builtin
    cost: free_or_low
    priority: mvp

  x_search:
    status: optional
    type: openclaw_builtin
    cost: depends_provider
    priority: later

  firecrawl_scrape:
    status: disabled_waiting_budget
    type: provider_plugin
    cost: paid
    priority: phase_2

  tavily_search:
    status: disabled_waiting_budget
    type: provider_plugin
    cost: paid
    priority: phase_2

  enrichment_api:
    status: disabled_waiting_budget
    type: paid_vendor
    cost: paid
    priority: phase_4

  browser:
    status: optional
    type: openclaw_builtin
    cost: high_runtime
    priority: phase_2

  telegram_message:
    status: enabled
    type: channel
    cost: free
    priority: mvp
```

Checklist:

- [ ] Tool catalog dibuat
- [ ] Tools mahal diset disabled dulu
- [ ] Tools yang belum jelas diset `check_runtime`

---

# PHASE 6 — Custom Script Minimal

## 6.1 Email Intelligence Script

Buat:

```bash
nano scripts/email_intelligence.js
```

Isi:

```js
#!/usr/bin/env node

const email = process.argv[2];

const freeDomains = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'proton.me', 'protonmail.com', 'aol.com'
]);

const disposableHints = [
  'mailinator.com', 'tempmail', '10minutemail', 'guerrillamail'
];

function result(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

if (!email || !email.includes('@')) {
  result({
    ok: false,
    error: 'invalid_email',
    input: email || null
  });
  process.exit(1);
}

const [local, domainRaw] = email.toLowerCase().trim().split('@');
const domain = domainRaw.trim();
const isFreeEmail = freeDomains.has(domain);
const isDisposable = disposableHints.some(h => domain.includes(h));
const isRoleEmail = ['admin', 'info', 'support', 'sales', 'hello', 'contact'].includes(local);

result({
  ok: true,
  email,
  local,
  domain,
  is_free_email: isFreeEmail,
  is_disposable: isDisposable,
  is_role_email: isRoleEmail,
  initial_suspicion: isDisposable
    ? 'suspicious_spam'
    : isFreeEmail
      ? 'free_email_needs_public_identity_search'
      : 'possible_company_domain'
});
```

Jalankan:

```bash
chmod +x scripts/email_intelligence.js
node scripts/email_intelligence.js alex@acme.ai
node scripts/email_intelligence.js alex@gmail.com
```

Checklist:

- [ ] Script bisa parse email
- [ ] Bisa deteksi free/corporate/disposable sederhana
- [ ] Output JSON valid

## 6.2 Domain Checker Minimal

Buat:

```bash
nano scripts/domain_checker.sh
```

Isi:

```bash
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="$1"

if [ -z "$DOMAIN" ]; then
  echo '{"ok":false,"error":"missing_domain"}'
  exit 1
fi

HTTP_STATUS=$(curl -L -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$DOMAIN" || true)
TITLE=$(curl -L -s --max-time 10 "https://$DOMAIN" | grep -i -o "<title>.*</title>" | head -1 | sed -E 's/<\/?title>//g' || true)

cat <<JSON
{
  "ok": true,
  "domain": "$DOMAIN",
  "https_status": "$HTTP_STATUS",
  "website_active": $([ "$HTTP_STATUS" = "200" ] && echo true || echo false),
  "title": "$(echo "$TITLE" | sed 's/"/\\"/g')"
}
JSON
```

Jalankan:

```bash
chmod +x scripts/domain_checker.sh
./scripts/domain_checker.sh acme.ai
```

Checklist:

- [ ] Script bisa cek HTTPS
- [ ] Script ambil title sederhana
- [ ] Output JSON valid

---

# PHASE 7 — Prompt Operasional untuk Telegram MVP

## 7.1 Buat prompt dasar

Buat file:

```bash
nano config/prompts.md
```

Isi:

```md
# AI Company Detection Agent — Telegram MVP Prompt

Goal:
Tentukan apakah email/register input kemungkinan berkaitan dengan perusahaan.

Untuk MVP hari ini, input utama hanya email. Jika data lain tidak ada, jangan minta banyak klarifikasi.

Operating mode:
- Jalankan proses secara bertahap.
- Cek tool mana yang tersedia.
- Jika tool tidak tersedia, catat sebagai skipped atau failed.
- Jangan berhenti total hanya karena satu tool gagal.
- Berikan report balik ke Telegram.

Minimum process:
1. Parse email.
2. Extract domain.
3. Tentukan apakah email free provider atau possible company domain.
4. Jika possible company domain, cek apakah website domain aktif.
5. Jika web_search/web_fetch tersedia, gunakan untuk mencari company signal.
6. Jika tool belum tersedia, tulis alasan.
7. Berikan kesimpulan sementara dengan confidence rendah/sedang/tinggi.

Report wajib berisi:
- Input
- Kesimpulan sementara
- Proses berhasil
- Proses gagal
- Proses skipped / belum tersedia
- Tools available/unavailable
- Evidence yang ditemukan
- Rekomendasi next step

Claim safety:
- Corporate email cukup untuk menyebut possible company affiliation.
- Jangan sebut founder/owner tanpa bukti role eksplisit.
- Jika hanya email domain, jangan overclaim.
```

Checklist:

- [ ] Prompt operasional dibuat
- [ ] Prompt bisa dipakai copy-paste ke OpenClaw/agent

---

# PHASE 8 — Test Manual End-to-End Hari Ini

Karena custom tool integration mungkin belum rapi hari ini, jalankan test dengan bantuan prompt Telegram dulu.

## 8.1 Kirim test 1: corporate-like email

Telegram:

```text
/check alex@acme.ai

Gunakan mode MVP. Cek tool availability, lakukan email intelligence, domain check kalau bisa, web search/fetch kalau tersedia, lalu balas report proses berhasil/gagal/skipped.
```

Expected report:

- [ ] Email parsed
- [ ] Domain extracted
- [ ] Domain bukan free email
- [ ] Website/domain check attempted
- [ ] Tools yang belum tersedia disebut jelas
- [ ] Kesimpulan tidak overclaim

## 8.2 Kirim test 2: Gmail

Telegram:

```text
/check alexbuilder@gmail.com

Gunakan mode MVP. Karena email free provider, coba cari company signal dari username/local-part jika web_search tersedia. Kalau tidak tersedia, laporkan skipped.
```

Expected report:

- [ ] Email parsed
- [ ] Free email detected
- [ ] Public identity search attempted kalau tersedia
- [ ] Kalau tidak ada web tools, report tetap selesai
- [ ] Kesimpulan: unknown / needs more evidence

## 8.3 Kirim test 3: invalid email

Telegram:

```text
/check bukan-email
```

Expected:

- [ ] Agent bilang format email invalid
- [ ] Tidak menjalankan investigasi lanjutan
- [ ] Memberi contoh format benar

---

# PHASE 9 — Report Format untuk Telegram Hari Ini

Gunakan format ini:

```text
🔎 Company Detection MVP Report

Input:
- Email: {{email}}

Kesimpulan sementara:
{{classification_summary}}
Confidence: {{low|medium|high}} / {{score_if_available}}

Proses yang berhasil dilakukan:
✅ {{success_1}}
✅ {{success_2}}

Proses yang gagal dilakukan:
❌ {{failed_1}} — {{reason}}

Proses yang dilewati / belum tersedia:
⏭ {{skipped_1}} — {{reason}}
⏭ {{skipped_2}} — {{reason}}

Evidence ditemukan:
- {{evidence_1}}
- {{evidence_2}}

Tools status:
- email_intelligence: {{enabled/failed}}
- domain_checker: {{enabled/failed}}
- web_search: {{available/unavailable/not_tested}}
- web_fetch: {{available/unavailable/not_tested}}
- firecrawl: disabled_waiting_budget
- enrichment_api: disabled_waiting_budget

Rekomendasi:
{{next_action}}
```

Checklist:

- [ ] Report mudah dibaca dari Telegram
- [ ] Ada status berhasil/gagal/skipped
- [ ] Ada evidence
- [ ] Ada rekomendasi

---

# PHASE 10 — Definition of Done Hari Ini

MVP hari ini dianggap berhasil kalau:

- [ ] VPS bisa diakses via SSH.
- [ ] Docker dan Node.js terinstall.
- [ ] OpenClaw CLI terinstall.
- [ ] OpenClaw Gateway berjalan.
- [ ] Dashboard bisa diakses via SSH tunnel atau minimal gateway status OK.
- [ ] Telegram bot dibuat dari BotFather.
- [ ] Telegram bot connect ke OpenClaw.
- [ ] DM Telegram berhasil dipair/approved.
- [ ] User bisa kirim email ke bot.
- [ ] Bot membalas report company detection MVP.
- [ ] Report mencantumkan proses berhasil, gagal, skipped, dan tool availability.
- [ ] Jika Firecrawl/Tavily/enrichment belum ada, sistem tetap selesai dengan skipped reason.

---

# PHASE 11 — Setelah Hari Ini: Hardening MVP

## 11.1 Bikin command khusus

- [ ] `/check_email <email>`
- [ ] `/company_check <email>`
- [ ] `/tool_status`
- [ ] `/last_report`

## 11.2 Integrasi custom tools formal

- [ ] email_intelligence sebagai custom tool yang callable oleh OpenClaw/worker
- [ ] domain_checker sebagai custom tool
- [ ] evidence_store.write
- [ ] scoring_engine.score
- [ ] telegram_report_formatter

## 11.3 Tambah DB ringan

- [ ] Install Postgres
- [ ] Buat tabel `investigation_jobs`
- [ ] Buat tabel `tool_runs`
- [ ] Buat tabel `evidence_items`
- [ ] Buat tabel `final_reports`

## 11.4 Tambah worker

- [ ] Buat Node.js/FastAPI worker
- [ ] Endpoint `POST /jobs`
- [ ] Queue Redis/BullMQ
- [ ] Worker panggil OpenClaw / tools
- [ ] Simpan evidence
- [ ] Kirim report Telegram/Slack

---

# PHASE 12 — Roadmap Lengkap dari Nol ke Production

## Phase A — Server Foundation

- [ ] VPS siap
- [ ] SSH hardening
- [ ] Firewall
- [ ] Docker
- [ ] Node.js
- [ ] Basic monitoring

## Phase B — OpenClaw Foundation

- [ ] Install OpenClaw
- [ ] Onboarding model provider
- [ ] Gateway running
- [ ] Dashboard accessible
- [ ] Tool basic test

## Phase C — Telegram MVP

- [ ] BotFather token
- [ ] Telegram config
- [ ] Pairing DM
- [ ] Test reply
- [ ] Input email
- [ ] Report balik ke Telegram

## Phase D — Company Detection Logic MVP

- [ ] Email parser
- [ ] Free/corporate email detection
- [ ] Domain checker
- [ ] Basic web fetch/search
- [ ] Scoring sederhana
- [ ] Report format

## Phase E — Evidence Store

- [ ] Postgres
- [ ] Job schema
- [ ] Tool run schema
- [ ] Evidence schema
- [ ] Report schema

## Phase F — Scraping Upgrade

- [ ] Firecrawl API
- [ ] Tavily/Brave/Exa provider
- [ ] Website crawler router
- [ ] LinkedIn via SERP signal
- [ ] GitHub public checker
- [ ] X search

## Phase G — Slack Version

- [ ] Slack app
- [ ] Slack channel config
- [ ] Report to Slack
- [ ] Telegram remains dev/testing channel

## Phase H — Multi-Agent

- [ ] Orchestrator agent
- [ ] Web research agent
- [ ] Company website agent
- [ ] Public profile agent
- [ ] Scoring/report agent

## Phase I — Paid Enrichment

- [ ] Select vendor
- [ ] Add API adapter
- [ ] Add budget control
- [ ] Add skipped reason if disabled
- [ ] Add high-value lead routing

## Phase J — Production Ops

- [ ] Observability
- [ ] Error tracking
- [ ] Rate limit/backoff
- [ ] Tool cost tracking
- [ ] Human review dashboard
- [ ] Feedback loop

---

# 13. Operational Notes

## Tool status language

Gunakan status standar:

```text
enabled
available
not_configured
disabled_waiting_budget
rate_limited
failed
skipped_not_needed
skipped_policy
waiting_manual_review
```

## Classification hari ini

Untuk MVP Telegram-only, cukup:

```text
possible_company_affiliated
unknown_needs_more_evidence
likely_personal_email
suspicious_or_invalid
```

Jangan langsung pakai `founder_verified` kecuali benar-benar ada evidence kuat.

## Minimal scoring hari ini

```text
+30 domain bukan free email
+20 website domain aktif
+20 title/meta terlihat seperti company
+25 nama user ditemukan di website/company page
-40 disposable email
-20 website mati
-30 free email tanpa evidence tambahan
```

---

# 14. Referensi Resmi

- OpenClaw Getting Started: https://docs.openclaw.ai/start/getting-started
- OpenClaw Telegram Channel: https://docs.openclaw.ai/channels/telegram
- OpenClaw Tools: https://docs.openclaw.ai/tools
- OpenClaw Web Tools: https://docs.openclaw.ai/tools/web

---

# 15. Command Cheat Sheet

```bash
# SSH
ssh deploy@YOUR_SERVER_IP

# Update server
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Install OpenClaw
curl -fsSL https://openclaw.ai/install.sh | bash

# Onboard
openclaw onboard --install-daemon

# Gateway
openclaw gateway status
openclaw gateway
openclaw gateway restart

# Dashboard tunnel from local machine
ssh -L 18789:localhost:18789 deploy@YOUR_SERVER_IP

# Telegram pairing
openclaw pairing list telegram
openclaw pairing approve telegram <CODE>

# Logs
openclaw logs --follow
```

---

# 16. Final Target Hari Ini

Hari ini tidak perlu sempurna. Targetnya adalah membuktikan sistem bisa berjalan dari Telegram.

**Final demo:**

User kirim:

```text
/check alex@acme.ai
```

Bot balas:

```text
🔎 Company Detection MVP Report

Saya sudah mencoba memeriksa email alex@acme.ai.

Berhasil:
✅ Email berhasil diparse.
✅ Domain acme.ai berhasil diekstrak.
✅ Domain bukan free email provider.
✅ Domain check dicoba.

Belum berhasil / dilewati:
⏭ Firecrawl belum dipakai karena API key belum tersedia.
⏭ Enrichment API belum dipakai karena waiting budget.
⏭ Browser belum dipakai karena MVP hari ini Telegram-only.

Kesimpulan sementara:
Akun ini kemungkinan terafiliasi dengan perusahaan/domain acme.ai, tetapi belum cukup bukti untuk menyebut founder/owner.

Next step:
Aktifkan web_search/web_fetch atau Firecrawl untuk validasi website dan role evidence.
```

Kalau ini sudah jalan, MVP hari ini berhasil.
