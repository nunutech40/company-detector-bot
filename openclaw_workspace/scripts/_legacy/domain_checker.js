#!/usr/bin/env node
"use strict";

const dns = require("node:dns/promises");

function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref();
  return controller.signal;
}

function cleanTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return match[1].replace(/\s+/g, " ").trim().slice(0, 180) || null;
}

async function resolveSafe(fn) {
  try {
    return await fn();
  } catch (error) {
    return [];
  }
}

async function fetchWebsite(domain, protocol) {
  const url = `${protocol}://${domain}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: timeoutSignal(8000),
      headers: {
        "user-agent":
          "CompanyDetectionBot/0.1 (+https://example.internal/company-detection)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    let title = null;
    let body_sample = null;
    if (contentType.includes("text/html") || contentType.includes("text/plain")) {
      const body = await response.text();
      title = cleanTitle(body);
      body_sample = body.replace(/\s+/g, " ").trim().slice(0, 500) || null;
    }
    return {
      ok: true,
      url,
      final_url: response.url,
      status: response.status,
      active: response.status >= 200 && response.status < 400,
      content_type: contentType || null,
      title,
      body_sample,
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      active: false,
      error: error.name === "AbortError" ? "timeout" : error.message,
      latency_ms: Date.now() - started,
    };
  }
}

async function checkDomain(domainInput) {
  const domain = String(domainInput || "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return {
      ok: false,
      domain: domainInput || null,
      error: "invalid_domain",
      evidence: [
        {
          source_type: "domain_validation",
          reliability: "high",
          claim: "Domain format is invalid.",
          value: domainInput || null,
          confidence_delta: -20,
        },
      ],
    };
  }

  const [mx_records, a_records, aaaa_records, txt_records] = await Promise.all([
    resolveSafe(() => dns.resolveMx(domain)),
    resolveSafe(() => dns.resolve4(domain)),
    resolveSafe(() => dns.resolve6(domain)),
    resolveSafe(() => dns.resolveTxt(domain)),
  ]);

  const https = await fetchWebsite(domain, "https");
  const http = https.active ? null : await fetchWebsite(domain, "http");
  const best = https.active ? https : http && http.active ? http : https.ok ? https : http;

  const hasMx = mx_records.length > 0;
  const hasAddress = a_records.length > 0 || aaaa_records.length > 0;
  const websiteActive = Boolean(best && best.active);

  const evidence = [];
  if (hasMx) {
    evidence.push({
      source_type: "dns_mx",
      reliability: "high",
      claim: "Domain has MX records and can receive email.",
      value: mx_records.map((record) => record.exchange).slice(0, 5),
      confidence_delta: 10,
    });
  }
  if (hasAddress) {
    evidence.push({
      source_type: "dns_address",
      reliability: "medium",
      claim: "Domain resolves to web/server address records.",
      value: [...a_records, ...aaaa_records].slice(0, 5),
      confidence_delta: 5,
    });
  }
  if (websiteActive) {
    evidence.push({
      source_type: "company_website",
      source_url: best.final_url || best.url,
      reliability: "medium",
      claim: best.title
        ? "Domain website is active and has a readable title."
        : "Domain website is active.",
      value: best.title || best.final_url || best.url,
      confidence_delta: best.title ? 20 : 15,
    });
  } else {
    evidence.push({
      source_type: "company_website",
      source_url: best ? best.url : `https://${domain}`,
      reliability: "medium",
      claim: "Domain website did not return an active page during MVP check.",
      value: best ? best.error || best.status || null : null,
      confidence_delta: -20,
    });
  }

  return {
    ok: true,
    domain,
    mx_status: hasMx ? "present" : "not_found",
    mx_records: mx_records.slice(0, 10),
    has_address_records: hasAddress,
    a_records: a_records.slice(0, 10),
    aaaa_records: aaaa_records.slice(0, 10),
    txt_record_count: txt_records.length,
    website_active: websiteActive,
    website: best || null,
    evidence,
  };
}

if (require.main === module) {
  checkDomain(process.argv[2])
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    });
}

module.exports = {
  checkDomain,
};
