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
const { normalizeRegisterInput } = require("./input_normalizer");

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

function buildRecommendation(classification, emailIntel, input) {
  if (classification === "possible_company_affiliated") {
    return "Route sebagai lead/company-associated untuk automation ringan. Jangan route sebagai founder/owner sampai ada evidence role eksplisit.";
  }
  if (classification === "likely_personal_email") {
    if (input && (input.full_name || input.brand_name)) {
      return "Simpan sebagai personal/unknown sementara. Gunakan full_name dan brand_name sebagai hint enrichment, tapi jangan klaim relasi bisnis tanpa evidence publik eksplisit.";
    }
    return "Simpan sebagai personal/unknown. Automation register boleh lanjut tanpa segmentasi B2B sampai ada brand_name, website, atau evidence publik tambahan.";
  }
  if (classification === "suspicious_or_invalid") {
    return "Flag untuk validasi format/risk check sebelum automation lanjutan.";
  }
  return "Simpan sebagai unknown dan retry enrichment/search saat provider tersedia atau saat metadata tambahan masuk.";
}

function buildInputEvidence(input) {
  const evidence = [];
  if (input.full_name) {
    evidence.push({
      source_type: "register_input",
      reliability: "medium",
      claim: "Register input includes a full name that can support identity matching.",
      value: input.full_name,
      confidence_delta: 0,
    });
  }
  if (input.brand_name) {
    evidence.push({
      source_type: "register_input",
      reliability: "medium",
      claim: "Register input includes a brand name/business hint.",
      value: input.brand_name,
      confidence_delta: 10,
    });
  }
  if (input.no_hp) {
    evidence.push({
      source_type: "register_input",
      reliability: "medium",
      claim: "Register input includes phone data for internal matching only.",
      value: input.phone_masked,
      confidence_delta: 0,
    });
  }
  return evidence;
}

async function runCompanyCheck(inputPackage) {
  const normalizedInput = normalizeRegisterInput(inputPackage);
  const emailIntel = analyzeEmail(normalizedInput.email);
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
  const evidence = [...(emailIntel.evidence || []), ...buildInputEvidence(normalizedInput)];

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
      full_name: normalizedInput.full_name,
      brand_name: normalizedInput.brand_name,
      include_domain_queries: !emailIntel.is_free_email,
    });
    toolsUsed.push("serp_query_builder");

    const primaryQuery =
      emailIntel.is_free_email
        ? (serpQueries.queries || []).find((query) => normalizedInput.brand_name && query.includes(`"${normalizedInput.brand_name}"`)) ||
          (serpQueries.queries || []).find((query) => normalizedInput.full_name && query.includes(`"${normalizedInput.full_name}"`)) ||
          (serpQueries.queries || []).find((query) => query.includes(`"${emailIntel.local}"`))
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
    register_input: normalizedInput,
  });
  toolsUsed.push("scoring_engine");

  const result = {
    ok: emailIntel.ok,
    job_type: "company_detection_mvp",
    observed_at: nowIso(),
    input: {
      email: normalizedInput.email,
      full_name: normalizedInput.full_name || null,
      no_hp: normalizedInput.no_hp || null,
      phone_masked: normalizedInput.phone_masked || null,
      brand_name: normalizedInput.brand_name || null,
      ignored_fields: normalizedInput.ignored_fields,
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
    recommendation: buildRecommendation(scoreResult.classification, emailIntel, normalizedInput),
  };
  result.telegram_report = renderTelegramReport(result);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const shouldSave = args.includes("--save");
  const shouldSendSlack = args.includes("--send-slack") || process.env.COMPANY_DETECTION_SEND_SLACK === "true";
  const input = parseInputArgs(args);
  const result = await runCompanyCheck(input);
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

function getFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return "";
  return args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : "";
}

function parseInputArgs(args) {
  const inputJson = getFlagValue(args, "--input-json");
  if (inputJson) return JSON.parse(inputJson);

  const valueFlags = new Set(["--input-json", "--full-name", "--no-hp", "--brand-name"]);
  let positional = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional = arg;
      break;
    }
  }
  return {
    email: positional,
    full_name: getFlagValue(args, "--full-name"),
    no_hp: getFlagValue(args, "--no-hp"),
    brand_name: getFlagValue(args, "--brand-name"),
  };
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
  parseInputArgs,
};
