#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CATALOG_PATH = path.join(__dirname, "..", "config", "tool_catalog.yaml");

function parseCatalog(text) {
  const tools = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    const toolMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (toolMatch) {
      current = { name: toolMatch[1] };
      tools.push(current);
      continue;
    }

    const fieldMatch = line.match(/^    ([a-zA-Z0-9_-]+):\s*(.+?)\s*$/);
    if (current && fieldMatch) {
      current[fieldMatch[1]] = fieldMatch[2].replace(/^"|"$/g, "");
    }
  }

  return tools;
}

function renderStatus(tools) {
  const lines = ["Company Detection Tool Status", ""];
  for (const tool of tools) {
    lines.push(`- ${tool.name}: ${tool.status || "unknown"} (${tool.priority || "no_priority"})`);
  }
  return lines.join("\n");
}

function loadToolStatus() {
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  const tools = parseCatalog(raw);
  return {
    ok: true,
    observed_at: new Date().toISOString(),
    tools,
    report: renderStatus(tools),
  };
}

function main() {
  const result = loadToolStatus();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.report);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  }
}

module.exports = {
  loadToolStatus,
};
