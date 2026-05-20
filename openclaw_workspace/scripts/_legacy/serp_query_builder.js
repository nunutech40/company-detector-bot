#!/usr/bin/env node
"use strict";

function buildQueries(input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const fullName = String(input.full_name || input.name || "").trim();
  const brandName = String(input.brand_name || input.company_field || "").trim();
  const domain = String(input.domain || email.split("@")[1] || "").trim().toLowerCase();
  const local = String(input.local || email.split("@")[0] || "").trim();
  const rootName = domain ? domain.split(".")[0] : "";
  const domainOrBrand = brandName || domain;
  const includeDomainQueries = input.include_domain_queries !== false;

  const queries = [];
  if (domain && includeDomainQueries) {
    queries.push(`"${domain}" company`);
    queries.push(`site:${domain} about OR team OR contact`);
    queries.push(`"${rootName}" startup OR company OR platform`);
    queries.push(`"${domain}" LinkedIn`);
  }
  if (brandName) {
    queries.push(`"${brandName}" company OR business OR official`);
    queries.push(`"${brandName}" LinkedIn OR Instagram OR marketplace`);
  }
  if (fullName) {
    if (domainOrBrand) queries.push(`"${fullName}" "${domainOrBrand}"`);
    queries.push(`"${fullName}" founder OR owner OR company OR LinkedIn`);
  }
  if (local) {
    queries.push(`"${local}" GitHub OR Product Hunt OR LinkedIn`);
  }

  return {
    ok: true,
    email: email || null,
    domain: domain || null,
    include_domain_queries: includeDomainQueries,
    full_name: fullName || null,
    brand_name: brandName || null,
    queries: [...new Set(queries)].filter(Boolean),
  };
}

if (require.main === module) {
  const [email, full_name, brand_name] = process.argv.slice(2);
  console.log(JSON.stringify(buildQueries({ email, full_name, brand_name }), null, 2));
}

module.exports = {
  buildQueries,
};
