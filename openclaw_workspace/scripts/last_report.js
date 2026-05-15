#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readLastJsonl(filePath, emailFilter) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const item = JSON.parse(lines[index]);
    if (!emailFilter || item.email === emailFilter) return item;
  }
  return null;
}

function loadLastReport(emailInput, options = {}) {
  const baseDir = options.baseDir || process.env.COMPANY_DETECTION_DATA_DIR || process.cwd();
  const auditPath = path.join(baseDir, "evidence", "audit.jsonl");
  const email = emailInput ? String(emailInput).trim().toLowerCase() : null;
  const audit = readLastJsonl(auditPath, email);
  if (!audit) {
    return {
      ok: false,
      error: "last_report_not_found",
      email,
    };
  }
  return {
    ok: true,
    audit,
    report: fs.existsSync(audit.report_path) ? fs.readFileSync(audit.report_path, "utf8").trim() : null,
  };
}

function main() {
  const result = loadLastReport(process.argv[2]);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok && result.report) {
    console.log(result.report);
  } else {
    console.log("Belum ada report tersimpan untuk filter tersebut.");
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadLastReport,
};
