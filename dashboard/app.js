'use strict';

const express = require('express');
const path    = require('path');
const { Pool } = require('pg');
const fs      = require('fs');

// ── Load env ─────────────────────────────────────────────────────────────────
const ENV_FILE = '/home/nunuopc/.openclaw/gateway.systemd.env';
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://company_detection:cd_pass_2026@localhost:5432/company_detection';
const PORT         = process.env.DASHBOARD_PORT || 3001;

// ── DB Pool ───────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: DATABASE_URL });

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

// Force Excel exports to download instead of relying on browser/Slack preview.
app.get('/exports/:filename', (req, res) => {
  const filename = path.basename(req.params.filename || '');
  if (!/^[a-zA-Z0-9._-]+\.xlsx$/.test(filename)) return res.status(400).send('Invalid export filename');

  const filePath = path.join(__dirname, 'public', 'exports', filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Export not found');

  res.download(filePath, filename);
});

app.use(express.static(path.join(__dirname, 'public')));

// Render helper — wrap body in layout
function render(res, view, locals = {}) {
  res.render(view, locals, (err, body) => {
    if (err) return res.status(500).send(err.message);
    res.render('layout', { ...locals, body, title: locals.title });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const CLASSIFICATION_LABEL = {
  'possible_company_affiliated':    { label: 'Bisnis',    color: 'green'  },
  'likely_personal_email':          { label: 'Personal',  color: 'gray'   },
  'unknown_needs_more_evidence':    { label: 'Unknown',   color: 'yellow' },
  'suspicious_or_invalid':          { label: 'Suspicious',color: 'red'    },
};

function classInfo(c) {
  return CLASSIFICATION_LABEL[c] || { label: c || '—', color: 'gray' };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET / — Job list
app.get('/', async (req, res) => {
  try {
    const { classification, min_confidence, max_confidence, review_status, search, page, confidence_preset } = req.query;
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const pageSize = 25;
    const offset   = (pageNum - 1) * pageSize;

    // Translate confidence_preset ke min/max
    let minConf = min_confidence ? parseInt(min_confidence) : null;
    let maxConf = max_confidence ? parseInt(max_confidence) : null;
    if (confidence_preset === 'high')   { minConf = 75; maxConf = 100; }
    if (confidence_preset === 'medium') { minConf = 45; maxConf = 74;  }
    if (confidence_preset === 'low')    { minConf = 0;  maxConf = 44;  }

    const conditions = [];
    const params     = [];

    if (classification) {
      params.push(classification);
      conditions.push(`j.classification = $${params.length}`);
    }
    if (minConf !== null) {
      params.push(minConf);
      conditions.push(`j.confidence_score >= $${params.length}`);
    }
    if (maxConf !== null) {
      params.push(maxConf);
      conditions.push(`j.confidence_score <= $${params.length}`);
    }
    if (review_status) {
      params.push(review_status);
      conditions.push(`j.review_status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const p = params.length;
      conditions.push(`(j.email ILIKE $${p} OR j.business_name ILIKE $${p} OR j.person_name ILIKE $${p} OR j.domain ILIKE $${p})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count total
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM investigation_jobs j ${where}`,
      params
    );
    const total    = parseInt(countRes.rows[0].count);
    const totalPages = Math.ceil(total / pageSize);

    // Fetch jobs
    const jobsRes = await pool.query(
      `SELECT j.id, j.email, j.domain, j.full_name, j.business_name, j.business_city,
              j.person_name, j.person_role, j.classification, j.confidence_score,
              j.confidence_label, j.automation_action, j.review_status,
              j.marketplace_json, j.social_media_json, j.finished_at,
              l.total_tokens, l.cost_usd, l.model_name
       FROM investigation_jobs j
       LEFT JOIN LATERAL (
         SELECT total_tokens, cost_usd, model_name
         FROM llm_calls WHERE job_id = j.id
         ORDER BY called_at DESC LIMIT 1
       ) l ON true
       ${where}
       ORDER BY j.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    // Stats
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE classification = 'possible_company_affiliated') as company,
        COUNT(*) FILTER (WHERE classification = 'likely_personal_email') as personal,
        COUNT(*) FILTER (WHERE classification = 'unknown_needs_more_evidence') as unknown,
        COUNT(*) FILTER (WHERE classification = 'suspicious_or_invalid') as suspicious,
        ROUND(AVG(confidence_score)) as avg_confidence
      FROM investigation_jobs
    `);

    render(res, 'index', {
      jobs:        jobsRes.rows,
      stats:       statsRes.rows[0],
      classInfo,
      query:       req.query,
      page:        pageNum,
      totalPages,
      total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('DB error: ' + err.message);
  }
});

// GET /jobs/:id — Job detail
app.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const jobRes = await pool.query(
      `SELECT * FROM investigation_jobs WHERE id = $1`, [id]
    );
    if (!jobRes.rows.length) return res.status(404).send('Job not found');
    const job = jobRes.rows[0];

    const reportRes = await pool.query(
      `SELECT * FROM final_reports WHERE job_id = $1`, [id]
    );
    const report = reportRes.rows[0] || null;

    const llmRes = await pool.query(
      `SELECT * FROM llm_calls WHERE job_id = $1 ORDER BY called_at`, [id]
    );

    render(res, 'job_detail', {
      job,
      report,
      llmCalls: llmRes.rows,
      classInfo,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('DB error: ' + err.message);
  }
});

// POST /jobs/:id/review — Update review status
app.post('/jobs/:id/review', async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;
    const allowed    = ['unreviewed', 'reviewed', 'false_positive', 'high_value', 'needs_retry'];
    if (!allowed.includes(status)) return res.status(400).send('Invalid status');

    await pool.query(
      `UPDATE investigation_jobs SET review_status = $1 WHERE id = $2`,
      [status, id]
    );
    res.redirect(`/jobs/${id}`);
  } catch (err) {
    res.status(500).send('DB error: ' + err.message);
  }
});

// GET /search — Search
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.redirect('/');

  try {
    const jobsRes = await pool.query(
      `SELECT j.id, j.email, j.domain, j.business_name, j.person_name,
              j.classification, j.confidence_score, j.review_status, j.finished_at,
              j.social_media_json, j.marketplace_json
       FROM investigation_jobs j
       WHERE j.email ILIKE $1
          OR j.business_name ILIKE $1
          OR j.person_name ILIKE $1
          OR j.domain ILIKE $1
          OR j.social_media_json::text ILIKE $1
          OR j.marketplace_json::text ILIKE $1
       ORDER BY j.created_at DESC
       LIMIT 50`,
      [`%${q}%`]
    );

    render(res, 'search', {
      jobs:     jobsRes.rows,
      q,
      classInfo,
    });
  } catch (err) {
    res.status(500).send('DB error: ' + err.message);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running at http://0.0.0.0:${PORT}`);
});
