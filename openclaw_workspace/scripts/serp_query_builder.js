#!/usr/bin/env node
"use strict";

function buildQueries(input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const name = String(input.name || "").trim();
  const username = String(input.username || "").trim();
  const domain = String(input.domain || email.split("@")[1] || "").trim().toLowerCase();
  const local = String(input.local || email.split("@")[0] || username || "").trim();
  const rootName = domain ? domain.split(".")[0] : "";

  const queries = [];
  if (domain) {
    queries.push(`"${domain}" company`);
    queries.push(`site:${domain} about OR team OR contact`);
    queries.push(`"${rootName}" startup OR company OR platform`);
    queries.push(`"${domain}" LinkedIn`);
  }
  if (name) {
    queries.push(`"${name}" "${domain}"`);
    queries.push(`"${name}" founder OR company OR LinkedIn`);
  }
  if (username || local) {
    queries.push(`"${username || local}" GitHub OR Product Hunt OR LinkedIn`);
  }

  return {
    ok: true,
    email: email || null,
    domain: domain || null,
    queries: [...new Set(queries)].filter(Boolean),
  };
}

if (require.main === module) {
  const [email, name, username] = process.argv.slice(2);
  console.log(JSON.stringify(buildQueries({ email, name, username }), null, 2));
}

module.exports = {
  buildQueries,
};
