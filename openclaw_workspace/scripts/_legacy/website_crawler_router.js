#!/usr/bin/env node
"use strict";

const CANDIDATE_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/team",
  "/founders",
  "/contact",
  "/pricing",
  "/careers",
  "/privacy",
  "/terms",
];

function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref();
  return controller.signal;
}

function cleanText(value, limit = 900) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function extractTag(html, pattern) {
  const match = String(html || "").match(pattern);
  return match ? match[1].replace(/\s+/g, " ").trim().slice(0, 220) : null;
}

function extractPageSignals(html) {
  const text = cleanText(html, 2000).toLowerCase();
  const signalPatterns = [
    ["company_terms", /\b(company|business|platform|solution|service|customer|client|enterprise|commerce|e-commerce)\b/i],
    ["team_terms", /\b(team|founder|co-founder|leadership|career|jobs|hiring)\b/i],
    ["legal_terms", /\b(privacy policy|terms of service|terms and conditions|legal)\b/i],
    ["contact_terms", /\b(contact|support|sales|hello@|info@)\b/i],
  ];

  return signalPatterns
    .filter(([, regex]) => regex.test(text))
    .map(([name]) => name);
}

async function fetchPage(domain, pagePath) {
  const url = `https://${domain}${pagePath}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: timeoutSignal(7000),
      headers: {
        "user-agent": "CompanyDetectionBot/0.1 (+https://example.internal/company-detection)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const active = response.status >= 200 && response.status < 400;
    let html = "";
    if (active && (contentType.includes("text/html") || contentType.includes("text/plain"))) {
      html = await response.text();
    }
    return {
      ok: true,
      url,
      final_url: response.url,
      path: pagePath,
      status: response.status,
      active,
      content_type: contentType || null,
      title: extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      meta_description: extractTag(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i
      ),
      signals: extractPageSignals(html),
      text_sample: cleanText(html),
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      path: pagePath,
      active: false,
      error: error.name === "AbortError" ? "timeout" : error.message,
      latency_ms: Date.now() - started,
    };
  }
}

function uniquePages(pages) {
  const seen = new Set();
  return pages.filter((page) => {
    const key = page.final_url || page.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function crawlWebsite(domainInput, options = {}) {
  const domain = String(domainInput || "").trim().toLowerCase();
  const maxPages = Number(options.maxPages || process.env.COMPANY_DETECTION_MAX_CRAWL_PAGES || 6);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return {
      ok: false,
      domain: domainInput || null,
      error: "invalid_domain",
      pages: [],
      evidence: [],
    };
  }

  const selectedPaths = CANDIDATE_PATHS.slice(0, Math.max(1, maxPages));
  const pages = uniquePages(await Promise.all(selectedPaths.map((pagePath) => fetchPage(domain, pagePath))));
  const activePages = pages.filter((page) => page.active);
  const pagesWithSignals = activePages.filter((page) => page.signals && page.signals.length);

  const evidence = [];
  if (activePages.length) {
    evidence.push({
      source_type: "website_crawler",
      source_url: activePages[0].final_url || activePages[0].url,
      reliability: "medium",
      claim: "Website crawler found readable active pages.",
      value: activePages.map((page) => page.path).slice(0, 6),
      confidence_delta: Math.min(15, activePages.length * 3),
    });
  }
  if (pagesWithSignals.length) {
    evidence.push({
      source_type: "website_crawler",
      source_url: pagesWithSignals[0].final_url || pagesWithSignals[0].url,
      reliability: "medium",
      claim: "Website pages contain business/company signals.",
      value: pagesWithSignals
        .map((page) => `${page.path}:${page.signals.join("|")}`)
        .slice(0, 6),
      confidence_delta: Math.min(20, pagesWithSignals.length * 5),
    });
  }

  return {
    ok: true,
    domain,
    candidate_paths: selectedPaths,
    active_page_count: activePages.length,
    signal_page_count: pagesWithSignals.length,
    pages,
    evidence,
  };
}

if (require.main === module) {
  crawlWebsite(process.argv[2])
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
  crawlWebsite,
};
