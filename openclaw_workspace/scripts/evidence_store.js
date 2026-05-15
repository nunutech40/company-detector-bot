#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeSlug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, data) {
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`, "utf8");
}

function listFiles(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => {
      const filePath = path.join(dir, name);
      return { name, filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneFiles(dir, suffix, keepCount, protectedNames = []) {
  if (!Number.isFinite(keepCount) || keepCount < 1) return;
  const protectedSet = new Set(protectedNames);
  const files = listFiles(dir, suffix).filter((file) => !protectedSet.has(file.name));
  for (const file of files.slice(keepCount)) {
    fs.unlinkSync(file.filePath);
  }
}

function appendBoundedJsonl(filePath, data, keepLines) {
  appendJsonl(filePath, data);
  if (!Number.isFinite(keepLines) || keepLines < 1) return;
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length > keepLines) {
    fs.writeFileSync(filePath, `${lines.slice(-keepLines).join("\n")}\n`, "utf8");
  }
}

function storeResult(result, options = {}) {
  const baseDir = options.baseDir || process.env.COMPANY_DETECTION_DATA_DIR || process.cwd();
  const maxEvidenceFiles = Number(options.maxEvidenceFiles || process.env.COMPANY_DETECTION_MAX_EVIDENCE_FILES || 1000);
  const maxReportFiles = Number(options.maxReportFiles || process.env.COMPANY_DETECTION_MAX_REPORT_FILES || 1000);
  const maxAuditLines = Number(options.maxAuditLines || process.env.COMPANY_DETECTION_MAX_AUDIT_LINES || 5000);
  const evidenceDir = path.join(baseDir, "evidence");
  const reportsDir = path.join(baseDir, "reports");
  ensureDir(evidenceDir);
  ensureDir(reportsDir);

  const hash = crypto
    .createHash("sha256")
    .update(`${result.input?.email || ""}:${result.observed_at || ""}`)
    .digest("hex")
    .slice(0, 12);
  const slug = `${safeSlug(result.input?.email)}-${hash}`;

  const jsonPath = path.join(evidenceDir, `${slug}.json`);
  const reportPath = path.join(reportsDir, `${slug}.txt`);
  const auditPath = path.join(evidenceDir, "audit.jsonl");
  const latestJsonPath = path.join(evidenceDir, "latest.json");
  const latestReportPath = path.join(reportsDir, "latest.txt");

  writeJson(jsonPath, result);
  fs.writeFileSync(reportPath, `${result.telegram_report || ""}\n`, "utf8");
  writeJson(latestJsonPath, result);
  fs.writeFileSync(latestReportPath, `${result.telegram_report || ""}\n`, "utf8");
  appendBoundedJsonl(auditPath, {
    observed_at: result.observed_at,
    email: result.input?.email || null,
    classification: result.classification,
    confidence_score: result.confidence_score,
    json_path: jsonPath,
    report_path: reportPath,
  }, maxAuditLines);
  pruneFiles(evidenceDir, ".json", maxEvidenceFiles, ["latest.json"]);
  pruneFiles(reportsDir, ".txt", maxReportFiles, ["latest.txt"]);

  return {
    ok: true,
    json_path: jsonPath,
    report_path: reportPath,
    audit_path: auditPath,
    latest_json_path: latestJsonPath,
    latest_report_path: latestReportPath,
    retention: {
      max_evidence_files: maxEvidenceFiles,
      max_report_files: maxReportFiles,
      max_audit_lines: maxAuditLines,
    },
  };
}

if (require.main === module) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(JSON.stringify({ ok: false, error: "missing_json_file" }, null, 2));
    process.exit(1);
  }
  const result = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(JSON.stringify(storeResult(result), null, 2));
}

module.exports = {
  storeResult,
};
