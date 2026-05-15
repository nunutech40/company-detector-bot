#!/usr/bin/env node
"use strict";

const { analyzeEmail } = require("./email_intelligence");
const { checkDomain } = require("./domain_checker");
const { storeResult } = require("./evidence_store");
const { scoreCompanyEvidence } = require("./scoring_engine");
const { crawlWebsite } = require("./website_crawler_router");
const { buildQueries } = require("./serp_query_builder");
const { renderTelegramReport } = require("./report_formatter");
const { sendToSlack } = require("./slack_reporter");
const { searchDuckDuckGo } = require("./ddg_search");
const { scrapeUrl } = require("./free_scraper");

function nowIso() {
  return new Date().toISOString();
}

function buildSummary(classification, emailIntel, domainCheck) {
  if (classification === "suspicious_or_invalid") {
    return "Input email tidak valid atau memiliki sinyal disposable/suspicious.";
  }
  if (classification === "likely_personal_email") {
    return `Email memakai provider personal/free (${emailIntel.domain}), jadi belum ada sinyal perusahaan dari domain saja.`;
  }
  if (classification === "possible_company_affiliated") {
    const websitePart = domainCheck && domainCheck.website_active
      ? " Domain juga terlihat aktif saat dicek."
      : "";
    return `Domain ${emailIntel.domain} adalah custom domain, bukan provider email gratis.${websitePart} Ini cukup untuk menyimpulkan kemungkinan terafiliasi perusahaan, tapi belum cukup untuk klaim founder/owner.`;
  }
  return "Evidence belum cukup kuat untuk klaim perusahaan yang aman.";
}

function buildRecommendation(classification, emailIntel) {
  if (classification === "possible_company_affiliated") {
    return "Route sebagai lead/company-associated untuk automation ringan. Jangan route sebagai founder/owner sampai ada evidence role eksplisit.";
  }
  if (classification === "likely_personal_email") {
    return "Simpan sebagai personal/unknown. Automation register boleh lanjut tanpa segmentasi B2B sampai ada metadata tambahan seperti company, website, atau username publik.";
  }
  if (classification === "suspicious_or_invalid") {
    return "Flag untuk validasi format/risk check sebelum automation lanjutan.";
  }
  return "Simpan sebagai unknown dan retry enrichment/search saat provider tersedia atau saat metadata tambahan masuk.";
}

async function runCompanyCheck(emailInput) {
  const emailIntel = analyzeEmail(emailInput);
  const toolsUsed = ["email_intelligence"];
  const toolsSkipped = [
    { tool: "firecrawl_scrape", reason: "disabled_waiting_budget" },
    { tool: "tavily_search", reason: "disabled_waiting_budget" },
    { tool: "enrichment_api", reason: "disabled_waiting_budget" },
  ];
  const toolErrors = [];

  let domainCheck = null;
  let websiteCrawler = null;
  let serpQueries = null;
  let ddgSearch = null;
  let freeScraper = null;
  const evidence = [...(emailIntel.evidence || [])];

  if (emailIntel.ok && !emailIntel.is_free_email && !emailIntel.is_disposable) {
    domainCheck = await checkDomain(emailIntel.domain);
    toolsUsed.push("domain_checker");
    evidence.push(...(domainCheck.evidence || []));

    websiteCrawler = await crawlWebsite(emailIntel.domain);
    toolsUsed.push("website_crawler_router");
    evidence.push(...(websiteCrawler.evidence || []));
  }

  if (emailIntel.ok) {
    serpQueries = buildQueries({
      email: emailIntel.email,
      domain: emailIntel.domain,
      local: emailIntel.local,
    });
    toolsUsed.push("serp_query_builder");

    const primaryQuery =
      emailIntel.is_free_email
        ? (serpQueries.queries || []).find((query) => query.includes(`"${emailIntel.local}"`))
        : serpQueries.queries && serpQueries.queries[0];
    if (primaryQuery) {
      ddgSearch = await searchDuckDuckGo(primaryQuery, { limit: 5 });
      if (ddgSearch.ok) {
        toolsUsed.push("ddg_search");
        if (ddgSearch.results.length > 0) {
          evidence.push({
            source_type: "free_serp_search",
            source_url: ddgSearch.results[0].url,
            reliability: "low",
            claim: "Free SERP search returned public candidate results.",
            value: ddgSearch.results.map((item) => item.title).slice(0, 3),
            confidence_delta: 5,
          });
        }
      } else {
        toolErrors.push({ tool: "ddg_search", error: ddgSearch.error || "search_failed" });
      }
    } else {
      toolsSkipped.push({ tool: "ddg_search", reason: "no_search_query_built" });
    }
  }

  const scrapeTarget =
    (domainCheck && domainCheck.website_active && domainCheck.website && (domainCheck.website.final_url || domainCheck.website.url)) ||
    (websiteCrawler && websiteCrawler.pages || []).find((page) => page.active)?.final_url ||
    null;
  if (scrapeTarget) {
    freeScraper = await scrapeUrl(scrapeTarget, { limit: 2500 });
    if (freeScraper.ok) {
      toolsUsed.push("free_scraper");
      const text = freeScraper.content_snippet.toLowerCase();
      if (/\b(company|business|platform|solution|service|commerce|customer|client)\b/.test(text)) {
        evidence.push({
          source_type: "free_scraper",
          source_url: freeScraper.final_url || freeScraper.url,
          reliability: "low",
          claim: "Lightweight scraper found business-like page content.",
          value: freeScraper.content_snippet.slice(0, 220),
          confidence_delta: 5,
        });
      }
    } else {
      toolErrors.push({ tool: "free_scraper", error: freeScraper.error || "scrape_failed" });
    }
  } else {
    toolsSkipped.push({ tool: "free_scraper", reason: "no_active_url_to_scrape" });
  }

  const hasLightweightWebEvidence =
    Boolean(domainCheck && domainCheck.website_active) ||
    Boolean(websiteCrawler && websiteCrawler.active_page_count > 0) ||
    Boolean(freeScraper && freeScraper.ok);
  toolsSkipped.push({
    tool: "browser",
    reason: hasLightweightWebEvidence
      ? "skipped_not_needed_for_mvp"
      : "optional_fallback_disabled_for_mvp",
  });

  const scoreResult = scoreCompanyEvidence({
    base_score: 35,
    email_intelligence: emailIntel,
    domain_checker: domainCheck,
    website_crawler: websiteCrawler,
    evidence,
  });
  toolsUsed.push("scoring_engine");

  const result = {
    ok: emailIntel.ok,
    job_type: "company_detection_mvp",
    observed_at: nowIso(),
    input: {
      email: emailInput,
    },
    classification: scoreResult.classification,
    company_detected: scoreResult.company_detected,
    confidence_score: scoreResult.confidence_score,
    confidence_label: scoreResult.confidence_label,
    automation_action: scoreResult.automation_action,
    owner_claim_allowed: scoreResult.owner_claim_allowed,
    scoring: scoreResult.score_breakdown,
    email_intelligence: emailIntel,
    domain_checker: domainCheck,
    website_crawler: websiteCrawler,
    ddg_search: ddgSearch,
    free_scraper: freeScraper,
    serp_queries: serpQueries,
    tools_used: toolsUsed,
    tools_skipped: toolsSkipped,
    tool_errors: toolErrors,
    evidence,
    summary: buildSummary(scoreResult.classification, emailIntel, domainCheck),
    recommendation: buildRecommendation(scoreResult.classification, emailIntel),
  };
  result.telegram_report = renderTelegramReport(result);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const shouldSave = args.includes("--save");
  const shouldSendSlack = args.includes("--send-slack") || process.env.COMPANY_DETECTION_SEND_SLACK === "true";
  const email = args.find((arg) => !arg.startsWith("--"));
  const result = await runCompanyCheck(email);
  if (shouldSave) {
    result.storage = storeResult(result);
  }

  if (shouldSendSlack) {
    result.delivery = {
      slack_sent: await sendToSlack(result.telegram_report),
    };
  }
  
  console.log(asJson ? JSON.stringify(result, null, 2) : result.telegram_report);
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  runCompanyCheck,
  renderReport: renderTelegramReport,
};
