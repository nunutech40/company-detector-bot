#!/usr/bin/env node
/**
 * db_writer.js — Insert hasil investigasi ke PostgreSQL
 *
 * Dipanggil dari finish_investigation.sh setelah investigasi selesai.
 * Membaca:
 *   - evidence/latest.json       → classification, confidence, evidence items
 *   - reports/ai_report_latest.txt → full AI report text
 *   - openclaw sessions --json   → token usage per model
 *
 * Usage:
 *   node scripts/db_writer.js \
 *     --email <email> \
 *     [--full-name "<name>"] \
 *     [--brand-name "<brand>"] \
 *     [--ai-report "<path>"]     (default: reports/ai_report_latest.txt)
 *     [--evidence "<path>"]      (default: evidence/latest.json)
 *
 * Output: job_id yang baru dibuat (stdout)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('pg');

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const email      = get('--email');
const fullName   = get('--full-name');
const brandName  = get('--brand-name');
const source     = get('--source') || 'telegram';

if (!email) {
  console.error('db_writer: --email is required');
  process.exit(1);
}

const WORKSPACE    = path.resolve(__dirname, '..');
const evidencePath = get('--evidence') || path.join(WORKSPACE, 'evidence', 'latest.json');
const reportPath   = get('--ai-report') || path.join(WORKSPACE, 'reports', 'ai_report_latest.txt');
const ENV_FILE     = '/home/nunuopc/.openclaw/gateway.systemd.env';

// ── Load DATABASE_URL dari env file ─────────────────────────────────────────
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv(ENV_FILE);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('db_writer: skipped — DATABASE_URL not set');
  process.exit(0);
}

// ── Read files ───────────────────────────────────────────────────────────────
let evidenceJson = null;
if (fs.existsSync(evidencePath)) {
  try {
    evidenceJson = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (e) {
    console.error('db_writer: failed to parse evidence JSON:', e.message);
  }
}

let reportText = null;
if (fs.existsSync(reportPath)) {
  reportText = fs.readFileSync(reportPath, 'utf8').trim();
}

// ── Get token usage dari openclaw sessions ───────────────────────────────────
function getTokenUsage() {
  try {
    const raw = execSync('/home/nunuopc/.npm-global/bin/openclaw sessions --json 2>/dev/null', {
      timeout: 10000,
      encoding: 'utf8',
    });
    const data = JSON.parse(raw);
    const sessions = data.sessions || [];
    if (!sessions.length) return [];

    // Load pricing dari openclaw.json
    const configPath = '/home/nunuopc/.openclaw/openclaw.json';
    let costMap = {};
    if (fs.existsSync(configPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const providers = (cfg.models || {}).providers || {};
        for (const [providerName, providerCfg] of Object.entries(providers)) {
          for (const m of (providerCfg.models || [])) {
            const key = `${providerName}/${m.id}`;
            costMap[key] = {
              input:  (m.cost || {}).input  || 0,
              output: (m.cost || {}).output || 0,
            };
          }
        }
      } catch (_) {}
    }

    // Aggregate per model
    const byModel = {};
    for (const s of sessions) {
      const key = `${s.modelProvider}/${s.model}`;
      if (!byModel[key]) {
        byModel[key] = {
          model_provider:    s.modelProvider || 'unknown',
          model_name:        s.model || 'unknown',
          prompt_tokens:     0,
          completion_tokens: 0,
          total_tokens:      0,
        };
      }
      byModel[key].prompt_tokens     += s.inputTokens  || 0;
      byModel[key].completion_tokens += s.outputTokens || 0;
      byModel[key].total_tokens      += s.totalTokens  || 0;
    }

    return Object.entries(byModel).map(([key, m]) => {
      const pricing = costMap[key] || { input: 0, output: 0 };
      const costUsd = (m.prompt_tokens * pricing.input + m.completion_tokens * pricing.output) / 1_000_000;
      return { ...m, cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000 };
    });
  } catch (_) {
    return [];
  }
}

// ── Extract structured fields dari evidence JSON ─────────────────────────────
function extractFields(ev) {
  if (!ev) return {};

  const input = ev.input || {};

  // Dari evidence items — cari sosmed, marketplace, role evidence
  const evidenceItems = ev.evidence || [];
  const socialMedia   = [];
  const marketplace   = [];
  const roleEvidence  = [];

  for (const item of evidenceItems) {
    const src = (item.source_type || '').toLowerCase();
    const val = typeof item.value === 'string' ? item.value : JSON.stringify(item.value || '');
    const url = item.source_url || '';

    // Deteksi sosmed dari source_url
    if (url) {
      const platform = detectPlatform(url);
      if (platform && !['tokopedia','shopee','bukalapak','lazada'].includes(platform)) {
        if (!socialMedia.find(s => s.url === url)) {
          socialMedia.push({ platform, url, snippet: item.claim || '' });
        }
      }
      // Deteksi marketplace
      if (['tokopedia','shopee','bukalapak','lazada'].includes(platform)) {
        if (!marketplace.find(m => m.url === url)) {
          marketplace.push({ platform, url });
        }
      }
    }

    // Role evidence
    if (src === 'role_signal' || src === 'role_evidence' ||
        (item.claim || '').toLowerCase().includes('owner') ||
        (item.claim || '').toLowerCase().includes('founder') ||
        (item.claim || '').toLowerCase().includes('ceo')) {
      roleEvidence.push({
        quote:       val.slice(0, 300),
        source_url:  url,
        reliability: item.reliability || 'low',
      });
    }
  }

  // Dari AI report text — extract sosmed/marketplace yang disebut
  // (AI report lebih kaya dari Go CLI evidence)
  if (reportText) {
    extractFromReport(reportText, socialMedia, marketplace, roleEvidence);
  }

  return {
    email:            input.email || email,
    domain:           ev.email_intelligence?.domain || null,
    full_name:        input.full_name || fullName || null,
    brand_name:       input.brand_name || brandName || null,
    classification:   ev.classification || null,
    confidence_score: ev.confidence_score || 0,
    confidence_label: ev.confidence_label || null,
    automation_action: ev.automation_action || null,
    social_media_json:  socialMedia,
    marketplace_json:   marketplace,
    role_evidence_json: roleEvidence,
    json_result:        ev,
  };
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('instagram.com'))  return 'instagram';
  if (u.includes('linkedin.com'))   return 'linkedin';
  if (u.includes('facebook.com'))   return 'facebook';
  if (u.includes('tiktok.com'))     return 'tiktok';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('youtube.com'))    return 'youtube';
  if (u.includes('tokopedia.com'))  return 'tokopedia';
  if (u.includes('shopee.co.id') || u.includes('shope.ee')) return 'shopee';
  if (u.includes('bukalapak.com'))  return 'bukalapak';
  if (u.includes('lazada.co.id'))   return 'lazada';
  if (u.includes('flickr.com'))     return 'flickr';
  if (u.includes('pinterest.com'))  return 'pinterest';
  if (u.includes('github.com'))     return 'github';
  if (u.includes('orderonline.id')) return 'website';
  if (u.includes('mocmembership.com')) return 'moc';
  return null;
}

const MARKETPLACE_PLATFORMS = new Set(['tokopedia','shopee','bukalapak','lazada']);

// Parse angka terjual — support format: "161rb", "161.000", "161,000", "161k", "161 ribu"
function parseSold(text) {
  const m = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*(rb|ribu|k|jt|juta)?\s*(?:produk\s+)?terjual/i)
         || text.match(/sold[:\s]+([0-9]+(?:[.,][0-9]+)?)\s*(rb|ribu|k|jt|juta)?/i);
  if (!m) return null;
  let num = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'rb' || unit === 'ribu' || unit === 'k') num *= 1000;
  if (unit === 'jt' || unit === 'juta') num *= 1_000_000;
  return Math.round(num);
}

function extractFromReport(text, socialMedia, marketplace, roleEvidence) {
  // ── 1. Extract semua https:// URL ────────────────────────────────────────
  const urlRegex = /https?:\/\/[^\s\)\]\,\"\'<>]+/g;
  for (const rawUrl of (text.match(urlRegex) || [])) {
    const url      = rawUrl.replace(/[.,;:!?•]+$/, '');
    const platform = detectPlatform(url);
    if (!platform) continue;
    if (MARKETPLACE_PLATFORMS.has(platform)) {
      if (!marketplace.find(m => m.url === url)) {
        // Coba extract rating/sold dari context sekitar URL
        const idx    = text.indexOf(rawUrl);
        const ctx    = text.slice(Math.max(0, idx - 200), idx + 400);
        // Juga cari di seluruh teks untuk baris yang menyebut platform ini
        const platformLine = text.match(new RegExp(platform + '[^\\n]*(?:rating|terjual|review)[^\\n]*', 'i'));
        const fullCtx = ctx + (platformLine ? ' ' + platformLine[0] : '');
        const rating = (fullCtx.match(/[Rr]ating[:\s]+([0-9.]+)/) || fullCtx.match(/([0-9.]+)\s*\/\s*5/))?.[1] || null;
        const sold   = parseSold(fullCtx);
        const reviews= fullCtx.match(/([0-9]+(?:[.,][0-9]+)?(?:rb|ribu|k)?)\s*(?:ulasan|review)/i)?.[1];
        const reviewNum = reviews ? parseSold(reviews + ' terjual') : null;
        marketplace.push({
          platform,
          url,
          rating:       rating ? parseFloat(rating) : null,
          sold,
          review_count: reviewNum,
        });
      }
    } else {
      if (!socialMedia.find(s => s.url === url)) {
        // Coba extract followers/posts dari context
        const idx      = text.indexOf(rawUrl);
        const ctx      = text.slice(Math.max(0, idx - 150), idx + 150);
        const followers= (ctx.match(/([0-9,]+)\s*followers/))?.[1]?.replace(/,/g,'') || null;
        const posts    = (ctx.match(/([0-9,]+)\s*posts?/))?.[1]?.replace(/,/g,'') || null;
        const snippet  = ctx.replace(/https?:\/\/\S+/g,'').replace(/[•\-\*]/g,'').trim().slice(0,100);
        socialMedia.push({
          platform,
          url,
          followers: followers ? parseInt(followers) : null,
          posts:     posts     ? parseInt(posts)     : null,
          snippet:   snippet   || null,
        });
      }
    }
  }

  // ── 2. Extract non-https mentions (au.linkedin.com/..., facebook.com/...) ─
  const bareUrlRegex = /(?:^|[\s•\-:])(((?:au|www|id|m)\.)?(?:linkedin|facebook|instagram|tiktok|tokopedia|shopee|flickr|pinterest|twitter|youtube|github)\.(?:com|co\.id|id)\/[^\s\)\]\,\"\'<>•\]]+)/gm;
  for (const match of text.matchAll(bareUrlRegex)) {
    const raw      = match[1].trim().replace(/[.,;:!?•\]]+$/, '');
    const url      = raw.startsWith('http') ? raw : 'https://' + raw;
    const platform = detectPlatform(url);
    if (!platform) continue;
    if (MARKETPLACE_PLATFORMS.has(platform)) {
      if (!marketplace.find(m => m.url === url)) {
        // Perluas context untuk cari rating/sold — ambil seluruh baris
        const lineStart = text.lastIndexOf('\n', text.indexOf(match[1]));
        const lineEnd   = text.indexOf('\n', text.indexOf(match[1]));
        const ctx       = text.slice(Math.max(0, lineStart), lineEnd === -1 ? text.length : lineEnd + 300);
        const rating    = (ctx.match(/[Rr]ating[:\s]+([0-9.]+)/) || ctx.match(/([0-9.]+)\s*\/\s*5/))?.[1] || null;
        const sold      = parseSold(ctx);
        const reviewRaw = ctx.match(/([0-9]+(?:[.,][0-9]+)?(?:rb|ribu|k)?)\s*(?:ulasan|review)/i)?.[1];
        const reviewNum = reviewRaw ? parseSold(reviewRaw + ' terjual') : null;
        marketplace.push({
          platform, url,
          rating:       rating ? parseFloat(rating) : null,
          sold,
          review_count: reviewNum,
        });
      }
    } else {
      if (!socialMedia.find(s => s.url === url)) {
        const idx      = text.indexOf(match[1]);
        const ctx      = text.slice(Math.max(0, idx - 150), idx + 150);
        const followers= (ctx.match(/([0-9,]+)\s*followers/))?.[1]?.replace(/,/g,'') || null;
        const snippet  = ctx.replace(/https?:\/\/\S+/g,'').replace(/[•\-\*]/g,'').trim().slice(0,100);
        socialMedia.push({ platform, url, followers: followers ? parseInt(followers) : null, snippet: snippet || null });
      }
    }
  }

  // ── 3. Extract @handle mentions (Instagram, TikTok) ──────────────────────
  // Format: "Instagram @falasik" atau "TikTok @falasik"
  const handleRegex = /(?:Instagram|TikTok|Twitter|X)\s+@([\w.]+)/gi;
  for (const match of text.matchAll(handleRegex)) {
    const platformRaw = match[0].split(/\s+/)[0].toLowerCase().replace('twitter','twitter').replace('x','twitter');
    const handle      = match[1];
    const platform    = platformRaw === 'instagram' ? 'instagram'
                      : platformRaw === 'tiktok'    ? 'tiktok'
                      : 'twitter';
    const url         = platform === 'instagram' ? `https://instagram.com/${handle}`
                      : platform === 'tiktok'    ? `https://tiktok.com/@${handle}`
                      : `https://twitter.com/${handle}`;
    if (!socialMedia.find(s => s.url === url)) {
      // Cari followers di context
      const idx      = text.indexOf(match[0]);
      const ctx      = text.slice(Math.max(0, idx - 50), idx + 150);
      const followers= (ctx.match(/([0-9,]+)\s*followers/))?.[1]?.replace(/,/g,'') || null;
      const posts    = (ctx.match(/([0-9,]+)\s*posts?/))?.[1]?.replace(/,/g,'') || null;
      socialMedia.push({
        platform, url,
        handle:    '@' + handle,
        followers: followers ? parseInt(followers) : null,
        posts:     posts     ? parseInt(posts)     : null,
      });
    }
  }

  // ── 4. Extract role evidence dari quotes ─────────────────────────────────
  // Format: "quote" — source_url atau • "quote" — source
  const quotePatterns = [
    /["""]([^"""]{10,300})["""]\s*[—–\-]+\s*(https?:\/\/[^\s\n]+)/g,
    /["""]([^"""]{10,300})["""]\s*[—–\-]+\s*([a-z][^\s\n]{5,80})/g,
  ];
  for (const regex of quotePatterns) {
    for (const match of text.matchAll(regex)) {
      const quote  = match[1].trim();
      const source = match[2].trim();
      const srcUrl = source.startsWith('http') ? source : null;
      if (!roleEvidence.find(r => r.quote === quote)) {
        roleEvidence.push({ quote, source_url: srcUrl, source_label: source, reliability: 'medium' });
      }
    }
  }

  // ── 5. Post-process: enrich marketplace dengan data dari seluruh teks ──────
  const lines = text.split('\n');
  for (const m of marketplace) {
    if (m.sold === null || m.sold === undefined) {
      for (const line of lines) {
        if (!line.toLowerCase().includes(m.platform)) continue;
        const sold = parseSold(line);
        if (sold) { m.sold = sold; break; }
      }
    }
    if (!m.rating) {
      for (const line of lines) {
        if (!line.toLowerCase().includes(m.platform)) continue;
        const rm = line.match(/[Rr]ating[:\s]+([0-9.]+)/) || line.match(/([0-9.]+)\s*\/\s*5/);
        if (rm) { m.rating = parseFloat(rm[1]); break; }
      }
    }
    if (!m.review_count) {
      for (const line of lines) {
        if (!line.toLowerCase().includes(m.platform)) continue;
        const rr = line.match(/([0-9]+(?:[.,][0-9]+)?(?:rb|ribu|k)?)\s*(?:ulasan|review)/i)?.[1];
        if (rr) { m.review_count = parseSold(rr + ' terjual'); break; }
      }
    }
  }
}

function extractBusinessInfo(text) {
  if (!text) return {};
  const result = {};

  // ── Classification dari AI report ────────────────────────────────────────
  // Format: "Classification: Business Owner Confirmed" atau "BISNIS — 95/100"
  // atau "Classification: ✅ BISNIS" atau "PHASE 1: ... BUSINESS — 95/100"
  const classMatch = text.match(/Classification\s*[:\|]\s*[✅⚠️❌]?\s*([^\n|—–\d]+?)(?:\s*[|\-—]|\s*\n)/i)
                  || text.match(/PHASE\s*1[^:]*:\s*([A-Z][A-Z\s]+?)\s*[—–]\s*(\d+)\/100/i);
  if (classMatch) {
    const raw = classMatch[1].trim().toLowerCase();
    if (raw.includes('bisnis') || raw.includes('business') || raw.includes('company')) {
      result.classification   = 'possible_company_affiliated';
      result.automation_action = 'route_company_associated';
    } else if (raw.includes('personal')) {
      result.classification   = 'likely_personal_email';
      result.automation_action = 'continue_as_personal_or_unknown';
    }
  }

  // ── Confidence dari AI report ─────────────────────────────────────────────
  // Format: "Confidence: 70/100" atau "95/100" atau "BISNIS — 95/100"
  const confMatch = text.match(/Confidence\s*[:\|]\s*(\d+)\/100/i)
                 || text.match(/[—–]\s*(\d+)\/100/)
                 || text.match(/(\d+)\/100/);
  if (confMatch) {
    const score = parseInt(confMatch[1]);
    if (score > 0 && score <= 100) {
      result.confidence_score = score;
      result.confidence_label = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low';
    }
  }

  // ── Business name ─────────────────────────────────────────────────────────
  // Format: "Bisnis: Nawaystore" atau "Store Name: "falasik"" atau "TOKOPEDIA STORE — Store Name: ..."
  const bizMatch = text.match(/(?:^|•\s*)Bisnis\s*[:\|]\s*([^\n•|]+)/im)
                || text.match(/Store\s+Name\s*[:\|]\s*[""]?([^""\n•|,]+)/im)
                || text.match(/(?:Toko|Brand|Bisnis|Business)\s*[:\|]\s*([^\n•|]+)/im);
  if (bizMatch) {
    const candidate = bizMatch[1].trim().replace(/^[""]|[""]$/g, '').slice(0, 200);
    // Jangan simpan kalau isinya angka/delta scoring seperti "+5"
    if (!/^[+\-]?\d+$/.test(candidate)) {
      result.business_name = candidate;
    }
  }

  // ── Lokasi ────────────────────────────────────────────────────────────────
  const locMatch = text.match(/Lokasi\s*[:\|]\s*([^\n•|]+)/im)
                || text.match(/Location\s*[:\|]\s*([^\n•|]+)/im)
                || text.match(/📍\s*([^\n•|,]+)/m);
  if (locMatch) {
    const locFull = locMatch[1].trim().slice(0, 200);
    // Pisahkan alamat dan kota — "Jl. X, Kota Y" → alamat = "Jl. X", kota = "Kota Y"
    const cityMatch = locFull.match(/(?:Kota(?:\s+Administrasi)?|Kabupaten|Jakarta|Bandung|Surabaya|Yogyakarta|Semarang|Medan|Makassar|Depok|Bekasi|Tangerang|Bogor)[^\n,]*/i);
    if (cityMatch) {
      result.business_city    = cityMatch[0].trim().slice(0, 100);
      result.business_address = locFull.replace(cityMatch[0], '').replace(/,\s*$/, '').trim().slice(0, 200) || locFull.slice(0, 200);
    } else {
      result.business_city = locFull.slice(0, 100);
    }
  }

  // ── Website bisnis ────────────────────────────────────────────────────────
  const websiteMatch = text.match(/(?:Website|Domain|Situs)\s*[:\|]\s*(https?:\/\/[^\s\n•|]+)/i)
                    || text.match(/(?:Website|Domain|Situs)\s*[:\|]\s*([a-z0-9][a-z0-9\-\.]+\.[a-z]{2,}(?:\/[^\s\n•|]*)?)/i);
  if (websiteMatch) {
    const raw = websiteMatch[1].trim().replace(/[.,;:!?•]+$/, '');
    result.business_website = raw.startsWith('http') ? raw : 'https://' + raw;
  }

  // ── Person / Owner ────────────────────────────────────────────────────────
  // Format: "Owner: Tatak Subekti" atau "a.n Tatak Subekti" atau "Nama Falasik Naharudin ditemukan"
  const ownerMatch = text.match(/(?:Owner|Founder|CEO|Direktur|Pemilik)\s*[:\|]\s*([^\n•|—–]+)/i)
                  || text.match(/a\.n\s+([A-Z][a-zA-Z\s]{3,50})/)
                  || text.match(/Nama\s+([A-Z][a-zA-Z\s]{3,50})\s+ditemukan/i);
  if (ownerMatch) {
    result.person_name = ownerMatch[1].trim().replace(/\s*\(.*\)/, '').slice(0, 200);
    result.person_role = 'owner';
  }

  // ── Phone confirmed ───────────────────────────────────────────────────────
  if (/(?:HP|Phone|No\.?\s*HP)\s*[:\|].*(?:MATCH|✅|confirmed|terkonfirmasi)/i.test(text)) {
    result.phone_confirmed = true;
  }

  // ── Industry ─────────────────────────────────────────────────────────────
  const industryMap = {
    'fashion':     ['fashion', 'kacamata', 'baju', 'pakaian', 'thrift', 'sunglasses', 'clothing'],
    'suplemen':    ['suplemen', 'kesehatan', 'vitamin', 'herbal', 'skincare', 'perawatan tubuh', 'castor oil'],
    'kuliner':     ['makanan', 'minuman', 'kuliner', 'food', 'beverage', 'cafe', 'resto', 'catering'],
    'teknologi':   ['tech', 'software', 'digital', 'app', 'platform', 'saas', 'developer'],
    'e-commerce':  ['toko online', 'marketplace', 'jualan', 'reseller', 'dropship', 'affiliate'],
    'jasa':        ['jasa', 'service', 'konsultan', 'agency', 'freelance', 'studio'],
  };
  const lowerText = text.toLowerCase();
  for (const [industry, keywords] of Object.entries(industryMap)) {
    if (keywords.some(k => lowerText.includes(k))) {
      result.business_industry = industry;
      break;
    }
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const fields      = extractFields(evidenceJson);
    const bizInfo     = extractBusinessInfo(reportText);
    const tokenUsage  = getTokenUsage();

    // AI report override Go CLI — classification/confidence dari AI lebih akurat
    const classification   = bizInfo.classification   || fields.classification;
    const confidenceScore  = bizInfo.confidence_score || fields.confidence_score;
    const confidenceLabel  = bizInfo.confidence_label || fields.confidence_label;
    const automationAction = bizInfo.automation_action || fields.automation_action;

    const businessName     = bizInfo.business_name     || null;
    const businessIndustry = bizInfo.business_industry || null;
    const businessCity     = bizInfo.business_city     || null;
    const businessWebsite  = bizInfo.business_website  || null;
    const businessAddress  = bizInfo.business_address  || null;
    const personName       = bizInfo.person_name       || null;
    const personRole       = bizInfo.person_role       || null;
    const phoneConfirmed   = bizInfo.phone_confirmed   || false;

    // Sort sosmed: platform utama duluan
    const PLATFORM_PRIORITY = ['instagram','tiktok','linkedin','facebook','twitter','youtube','tokopedia','shopee','bukalapak','lazada','pinterest','flickr','github','website','moc'];
    fields.social_media_json.sort((a, b) => {
      const pa = PLATFORM_PRIORITY.indexOf(a.platform);
      const pb = PLATFORM_PRIORITY.indexOf(b.platform);
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    });

    // Insert investigation_jobs
    const jobRes = await client.query(`
      INSERT INTO investigation_jobs (
        email, domain, full_name, brand_name, source,
        classification, confidence_score, confidence_label, automation_action,
        business_name, business_industry, business_city, business_website, business_address,
        person_name, person_role, phone_confirmed,
        marketplace_json, social_media_json, role_evidence_json,
        finished_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20,
        NOW()
      ) RETURNING id
    `, [
      fields.email,
      fields.domain,
      fields.full_name,
      fields.brand_name,
      source,
      classification,
      confidenceScore,
      confidenceLabel,
      automationAction,
      businessName,
      businessIndustry,
      businessCity,
      businessWebsite,
      businessAddress,
      personName,
      personRole,
      phoneConfirmed,
      JSON.stringify(fields.marketplace_json),
      JSON.stringify(fields.social_media_json),
      JSON.stringify(fields.role_evidence_json),
    ]);

    const jobId = jobRes.rows[0].id;

    // Insert final_reports
    await client.query(`
      INSERT INTO final_reports (job_id, telegram_text, json_result)
      VALUES ($1, $2, $3)
      ON CONFLICT (job_id) DO UPDATE
        SET telegram_text = EXCLUDED.telegram_text,
            json_result   = EXCLUDED.json_result
    `, [
      jobId,
      reportText,
      fields.json_result ? JSON.stringify(fields.json_result) : null,
    ]);

    // Insert llm_calls
    for (const t of tokenUsage) {
      await client.query(`
        INSERT INTO llm_calls (
          job_id, model_provider, model_name,
          prompt_tokens, completion_tokens, total_tokens, cost_usd
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        jobId,
        t.model_provider,
        t.model_name,
        t.prompt_tokens,
        t.completion_tokens,
        t.total_tokens,
        t.cost_usd,
      ]);
    }

    console.log(`db_writer: OK — job_id=${jobId}`);
    console.log(`db_writer: classification=${classification} confidence=${confidenceScore}`);
    console.log(`db_writer: marketplace=${fields.marketplace_json.length} social=${fields.social_media_json.length} role_evidence=${fields.role_evidence_json.length}`);
    if (tokenUsage.length) {
      for (const t of tokenUsage) {
        console.log(`db_writer: llm ${t.model_provider}/${t.model_name} — ${t.total_tokens} tokens — $${t.cost_usd}`);
      }
    }

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('db_writer: error —', err.message);
  process.exit(1);
});
