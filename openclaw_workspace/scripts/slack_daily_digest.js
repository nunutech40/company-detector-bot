#!/usr/bin/env node
'use strict';

/**
 * slack_daily_digest.js — daily sales-ready prospect digest.
 *
 * Reads finalized investigation rows from PostgreSQL and posts one Slack
 * message. It never includes raw evidence, AI reasoning, tool traces, or
 * internal scoring details.
 */

const fs = require('fs');
const { Client } = require('pg');
const path = require('path');

const ENV_FILE = process.env.COMPANY_DETECTOR_ENV_FILE
  || `${process.env.HOME || '/home/nunuopc'}/.openclaw/gateway.systemd.env`;
loadEnv(ENV_FILE);

const { sendToSlack, uploadFileToSlack } = require('./slack_reporter');
const { writeSalesSheetXlsx, formatChannels } = require('./sales_sheet_exporter');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DASHBOARD_BASE_URL = (process.env.DASHBOARD_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const DASHBOARD_PUBLIC_BASE_URL = (process.env.DASHBOARD_PUBLIC_BASE_URL || DASHBOARD_BASE_URL.replace(':3001', '')).replace(/\/+$/, '');
const SALES_SHEET_EXPORT_DIR = process.env.SALES_SHEET_EXPORT_DIR
  || `${process.env.HOME || '/home/nunuopc'}/.openclaw/dashboard/public/exports`;
const SALES_SHEET_LATEST_URL = process.env.SALES_SHEET_LATEST_URL || `${DASHBOARD_PUBLIC_BASE_URL}/sales-sheet/latest.xlsx`;
const SALES_SHEET_WEB_URL = process.env.SALES_SHEET_WEB_URL || `${DASHBOARD_PUBLIC_BASE_URL}/sales-sheet`;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const testRun = args.includes('--test-run');
const includeSent = args.includes('--include-sent') || testRun;
const windowHours = readIntArg('--window-hours', 24);
const minConfidence = readIntArg('--min-confidence', parseInt(process.env.SLACK_DIGEST_MIN_CONFIDENCE || '60', 10));

if (!DATABASE_URL) {
  console.error('slack_daily_digest: DATABASE_URL is required');
  process.exit(1);
}

main().catch((err) => {
  console.error('slack_daily_digest: fatal:', err.message);
  process.exit(1);
});

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const window = await getDigestWindow(client);
    const prospects = await getProspects(client, window);
    const salesSheet = exportSalesSheet(prospects, window, { testRun });
    const linkMessage = buildMessage(prospects, window, { testRun, salesSheetText: `<${SALES_SHEET_WEB_URL}|Open Sales Sheet>` });
    const attachmentMessage = buildMessage(prospects, window, { testRun, salesSheetText: 'file Excel terlampir di pesan ini' });

    if (dryRun) {
      console.log(linkMessage);
      console.log(`\nslack_daily_digest: dry_run prospect_count=${prospects.length}`);
      return;
    }

    if (testRun) {
      const sent = await sendDigestToSlack(attachmentMessage, linkMessage, salesSheet);
      console.log(`slack_daily_digest: test_run sent=${sent} prospect_count=${prospects.length}`);
      process.exitCode = sent ? 0 : 1;
      return;
    }

    const digestRun = await createDigestRun(client, window, prospects.length, 'pending');
    const sent = await sendDigestToSlack(attachmentMessage, linkMessage, salesSheet);

    if (!sent) {
      await updateDigestRun(client, digestRun.id, 'failed', null, 'slack_send_failed');
      console.error('slack_daily_digest: failed to send Slack message');
      process.exitCode = 1;
      return;
    }

    await markDigestItems(client, digestRun.id, prospects);
    await updateDigestRun(client, digestRun.id, 'sent', null, null);
    console.log(`slack_daily_digest: sent prospect_count=${prospects.length}`);
  } finally {
    await client.end();
  }
}

async function getDigestWindow(client) {
  if (testRun || args.includes('--ignore-last-run')) {
    const end = new Date();
    return {
      start: new Date(end.getTime() - windowHours * 60 * 60 * 1000),
      end,
    };
  }

  const last = await client.query(`
    SELECT window_end
    FROM slack_digest_runs
    WHERE status = 'sent'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const end = new Date();
  const start = last.rows[0]?.window_end
    ? new Date(last.rows[0].window_end)
    : new Date(end.getTime() - windowHours * 60 * 60 * 1000);
  return { start, end };
}

async function getProspects(client, window) {
  const result = await client.query(`
    WITH candidates AS (
      SELECT
        j.id,
        j.email,
        j.full_name,
        j.brand_name,
        j.business_name,
        j.business_industry,
        j.business_website,
        j.business_city,
        j.person_name,
        j.person_role,
        j.marketplace_json,
        j.social_media_json,
        j.role_evidence_json,
        j.source,
        j.confidence_score,
        j.finished_at,
        j.created_at,
        r.no_hp_masked,
        r.payload_json,
        r.source AS register_source,
        COALESCE(j.finished_at, j.created_at) AS event_time
      FROM investigation_jobs j
      LEFT JOIN LATERAL (
        SELECT no_hp_masked, payload_json, source
        FROM register_intake_jobs
        WHERE investigation_job_id = j.id
           OR LOWER(email) = LOWER(j.email)
        ORDER BY processed_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      ) r ON true
      WHERE j.classification = 'possible_company_affiliated'
        AND COALESCE(j.confidence_score, 0) >= $3
        AND COALESCE(j.finished_at, j.created_at) >= $1
        AND COALESCE(j.finished_at, j.created_at) < $2
        AND (
          $4::boolean = TRUE
          OR NOT EXISTS (
          SELECT 1
          FROM slack_digest_items i
          WHERE i.investigation_job_id = j.id
          )
        )
    ),
    deduped AS (
      SELECT DISTINCT ON (LOWER(email))
        id,
        email,
        full_name,
        brand_name,
        business_name,
        business_industry,
        business_website,
        business_city,
        person_name,
        person_role,
        marketplace_json,
        social_media_json,
        role_evidence_json,
        source,
        confidence_score,
        finished_at,
        created_at,
        no_hp_masked,
        payload_json,
        register_source,
        event_time
      FROM candidates
      ORDER BY LOWER(email), COALESCE(confidence_score, 0) DESC, event_time DESC
    )
    SELECT
      id,
      email,
      full_name,
      brand_name,
      business_name,
      business_industry,
      business_website,
      business_city,
      person_name,
      person_role,
      marketplace_json,
      social_media_json,
      role_evidence_json,
      source,
      confidence_score,
      finished_at,
      created_at,
      no_hp_masked,
      payload_json,
      register_source
    FROM deduped
    ORDER BY COALESCE(confidence_score, 0) DESC, event_time DESC
    LIMIT 50
  `, [window.start, window.end, minConfidence, includeSent]);
  return result.rows;
}

function buildMessage(prospects, window, options = {}) {
  const titleDate = formatJakarta(new Date());
  const windowText = `${formatJakarta(window.start)} - ${formatJakarta(window.end)}`;
  const lines = [
    `${options.testRun ? '[TEST] ' : ''}Prospect Digest - ${titleDate}`,
    `Sales Sheet: ${options.salesSheetText}`,
    `Window: ${windowText}`,
    '',
  ];

  if (!prospects.length) {
    lines.push('Tidak ada prospect baru dalam window terakhir.');
    lines.push('Pipeline tetap berjalan.');
    return lines.join('\n');
  }

  lines.push(`Ada ${prospects.length} kandidat baru untuk ditinjau dan di-follow up.`);
  lines.push('');

  prospects.forEach((job, index) => {
    const name = displayName(job);
    const contact = job.email;
    const whatsapp = extractPhone(job);
    const marketplace = formatChannels(job.marketplace_json, { maxItems: 2 });
    const socialMedia = formatChannels(job.social_media_json, { maxItems: 3 });
    const guidance = buildProspectGuidance(job);
    const priority = outreachPriority(job.confidence_score, guidance.fit);
    lines.push(`${index + 1}. ${name}`);
    lines.push(`   Kontak: ${contact}`);
    if (whatsapp) lines.push(`   WhatsApp: ${whatsapp}`);
    lines.push(`   Prioritas outreach: ${priority}`);
    lines.push(`   Status prospect: ${guidance.fit}`);
    lines.push(`   Kesimpulan: ${guidance.conclusion}`);
    lines.push(`   Relasi bisnis: ${guidance.relationship}`);
    if (job.business_website) lines.push(`   Website: ${job.business_website}`);
    if (marketplace) lines.push(`   Marketplace: ${marketplace}`);
    if (socialMedia) lines.push(`   Sosial Media: ${socialMedia}`);
    if (index !== prospects.length - 1) lines.push('');
  });

  return lines.join('\n');
}

function exportSalesSheet(prospects, window, options = {}) {
  const suffix = options.testRun ? 'test' : 'daily';
  const filename = `company-detector-prospects-${suffix}-${fileTimestamp(window.end)}.xlsx`;
  const outputPath = path.join(SALES_SHEET_EXPORT_DIR, filename);
  writeSalesSheetXlsx(outputPath, prospects, { dashboardBaseUrl: DASHBOARD_PUBLIC_BASE_URL });
  return {
    path: outputPath,
    filename,
    url: SALES_SHEET_LATEST_URL,
  };
}

function extractPhone(job) {
  const payload = parseJsonObject(job.payload_json);
  return payload.no_hp || payload.phone || payload.phone_number || payload.mobile || job.no_hp_masked || '';
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

async function sendDigestToSlack(attachmentMessage, linkMessage, salesSheet) {
  const uploaded = await uploadFileToSlack(salesSheet.path, {
    filename: salesSheet.filename,
    title: 'Company Detector Prospect Sheet',
    initialComment: attachmentMessage,
  });
  if (uploaded) return true;

  return sendToSlack(linkMessage);
}

function fileTimestamp(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

function displayName(job) {
  const candidates = [
    cleanDisplayValue(job.brand_name),
    cleanBusinessName(job.business_name),
    cleanDisplayValue(job.full_name),
    job.email,
  ];
  return candidates.find(Boolean) || job.email;
}

function cleanDisplayValue(value) {
  const text = String(value || '').trim();
  if (!text || /^(null|undefined|unknown|n\/a|-)$/i.test(text)) return '';
  if (/^(nama|domain|website|deskripsi)(\s*,\s*(nama|domain|website|deskripsi))+$/i.test(text)) return '';
  return text;
}

function cleanBusinessName(value) {
  const text = String(value || '')
    .replace(/\*\*/g, '')
    .replace(/^nama:\s*/i, '')
    .trim();
  if (!text || /^(null|undefined|unknown|n\/a|-)(?:\s|\(|$)/i.test(text)) return '';
  if (!cleanDisplayValue(text)) return '';
  if (text.length > 60) return '';
  if (/alat:|web_search|web_fetch|location:|education:/i.test(text)) return '';
  return text;
}

function prospectTier(confidence) {
  const score = Number(confidence || 0);
  if (score >= 75) return 'Hot prospect';
  return 'Warm prospect';
}

function outreachPriority(confidence, fit) {
  if (/bukan prospect utama|bukti bisnis lemah/i.test(fit)) return 'Review only';
  if (/perlu verifikasi role/i.test(fit)) return 'Qualification first';
  return prospectTier(confidence);
}

function buildProspectGuidance(job) {
  const person = cleanPersonName(job.person_name) || cleanPersonName(job.full_name) || 'Kontak ini';
  const business = cleanDisplayValue(job.brand_name) || cleanBusinessName(job.business_name);
  const role = normalizeRole(job.person_role) || roleFromEvidence(job.role_evidence_json);
  const personalProject = hasPersonalProjectSignal(job);
  const hasBusinessAsset = Boolean(
    business
    || cleanDisplayValue(job.business_website)
    || parseJsonList(job.marketplace_json).length
  );

  if (role) {
    const roleLabel = formatRole(role);
    const target = business ? ` pada ${business}` : ' pada bisnis yang teridentifikasi';
    const decisionMaker = /owner|founder|ceo|direktur|pemilik|co-founder/i.test(role);
    return {
      fit: decisionMaker ? 'Prospek utama - pengambil keputusan' : 'Prospek relevan - relasi bisnis teridentifikasi',
      conclusion: `${person} terindikasi sebagai ${roleLabel}${target}.`,
      relationship: `${roleLabel}${business ? ` di ${business}` : ''}.`,
    };
  }

  if (personalProject) {
    return {
      fit: 'Perlu verifikasi - bukan prospect utama',
      conclusion: `${person} saat ini lebih kuat terindikasi sebagai akun atau proyek personal/hobbyist.`,
      relationship: business
        ? `Ada jejak ${business}, tetapi belum ada bukti bahwa kontak ini pemilik atau pengelola bisnis.`
        : 'Belum ditemukan bukti kepemilikan, pengelolaan, atau role pada bisnis.',
    };
  }

  if (hasBusinessAsset) {
    return {
      fit: 'Perlu verifikasi role',
      conclusion: `${person} memiliki keterkaitan dengan ${business || 'aset bisnis/kanal penjualan'}, tetapi perannya belum teridentifikasi.`,
      relationship: business
        ? `Terhubung dengan ${business}; status owner, pengelola, karyawan, atau partner belum dapat dipastikan.`
        : 'Memiliki kanal bisnis, tetapi hubungan personal dengan bisnis belum dapat dipastikan.',
    };
  }

  return {
    fit: 'Perlu verifikasi - bukti bisnis lemah',
    conclusion: `${person} belum memiliki profil bisnis yang cukup jelas untuk langsung dianggap prospect utama.`,
    relationship: 'Relasi bisnis dan role belum teridentifikasi.',
  };
}

function cleanPersonName(value) {
  const text = cleanDisplayValue(value);
  if (!text || /^https?:\/\//i.test(text) || /[@/]/.test(text)) return '';
  const firstStatement = text.split(/[.*"“”|]/)[0].trim();
  if (!firstStatement || firstStatement.length > 80) return '';
  if (firstStatement.split(/\s+/).length > 7) return '';
  return firstStatement;
}

function hasPersonalProjectSignal(job) {
  const values = [
    job.brand_name,
    job.business_name,
    job.business_industry,
    job.person_role,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return /(proyek|project)\s+personal|personal\s+(project|proyek)|hobbyist|playground|portofolio|portfolio|eksperimen pribadi/.test(values);
}

function normalizeRole(value, strict = false) {
  const text = cleanDisplayValue(value).toLowerCase();
  if (!text) return '';
  if (/owner|pemilik/.test(text)) return 'owner';
  if (/co[- ]?founder/.test(text)) return 'co-founder';
  if (/founder|pendiri/.test(text)) return 'founder';
  if (/ceo|chief executive/.test(text)) return 'CEO';
  if (/direktur|director/.test(text)) return 'direktur';
  if (/distributor/.test(text)) return 'distributor';
  if (/reseller/.test(text)) return 'reseller';
  if (/merchant|seller|penjual/.test(text)) return 'merchant';
  if (/marketing/.test(text)) return 'marketing';
  if (/admin/.test(text)) return 'admin';
  if (/manager|manajer/.test(text)) return 'manager';
  return strict ? '' : text.slice(0, 60);
}

function roleFromEvidence(value) {
  const evidence = parseJsonList(value);
  for (const item of evidence) {
    const text = typeof item === 'string'
      ? item
      : `${item.quote || ''} ${item.claim || ''} ${item.value || ''}`;
    const role = normalizeRole(text, true);
    if (role) return role;
  }
  return '';
}

function formatRole(role) {
  if (role === 'owner') return 'pemilik';
  if (role === 'founder') return 'pendiri';
  if (role === 'co-founder') return 'co-founder';
  return role;
}

function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return [value];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    return parsed && typeof parsed === 'object' ? [parsed] : [];
  } catch (_err) {
    return [];
  }
}

async function createDigestRun(client, window, prospectCount, status) {
  const result = await client.query(`
    INSERT INTO slack_digest_runs (
      window_start, window_end, prospect_count, status, dashboard_url
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [window.start, window.end, prospectCount, status, DASHBOARD_BASE_URL]);
  return result.rows[0];
}

async function updateDigestRun(client, id, status, slackMessageTs, error) {
  await client.query(`
    UPDATE slack_digest_runs
    SET status = $2,
        slack_message_ts = $3,
        error = $4
    WHERE id = $1
  `, [id, status, slackMessageTs, error]);
}

async function markDigestItems(client, digestRunId, prospects) {
  for (const job of prospects) {
    await client.query(`
      INSERT INTO slack_digest_items (digest_run_id, investigation_job_id)
      VALUES ($1, $2)
      ON CONFLICT (investigation_job_id) DO NOTHING
    `, [digestRunId, job.id]);
  }
}

function formatJakarta(value) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value)).replace(/\./g, ':') + ' WIB';
}

function readIntArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const parsed = parseInt(args[idx + 1], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
