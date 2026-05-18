#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { runCompanyCheck } = require("./company_check");
const { storeResult } = require("./evidence_store");
const { sendToSlack } = require("./slack_reporter");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow || []).map((header) => header.trim());
  return dataRows.map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index] ? row[index].trim() : "";
    });
    return object;
  });
}

function getFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return "";
  return args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : "";
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith("--"));
  if (!filePath) throw new Error("csv_file_required");

  const limit = Number(getFlagValue(args, "--limit") || 0);
  const shouldSave = args.includes("--save");
  const shouldSendSlack = args.includes("--send-slack") || process.env.COMPANY_DETECTION_SEND_SLACK === "true";
  const rows = rowsToObjects(parseCsv(fs.readFileSync(filePath, "utf8")));
  const selectedRows = limit > 0 ? rows.slice(0, limit) : rows;

  for (let index = 0; index < selectedRows.length; index += 1) {
    const result = await runCompanyCheck(selectedRows[index]);
    if (shouldSave) result.storage = storeResult(result);
    if (shouldSendSlack) {
      result.delivery = { slack_sent: await sendToSlack(result.telegram_report) };
    }
    console.log(JSON.stringify({
      row: index + 1,
      ok: result.ok,
      input: result.input,
      classification: result.classification,
      confidence_score: result.confidence_score,
      automation_action: result.automation_action,
      tool_errors: result.tool_errors,
    }));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  parseCsv,
  rowsToObjects,
};
