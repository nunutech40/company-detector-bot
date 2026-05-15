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
    { tool: "firecrawl_scrape", reason: "(waiting budget) → diganti dengan free_scraper" },
    { tool: "enrichment_api", reason: "(waiting budget) → diganti dengan pencarian SERP Dorking" },
    { tool: "browser", reason: "tidak dipakai karena bukti web fetch sederhana sudah mencukupi untuk MVP" },
  ];

  let domainCheck = null;
  let websiteCrawler = null;
  let serpQueries = null;
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
    toolsUsed.push("ddg_search"); // Menandakan bahwa Free Search dipakai
  }

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
    serp_queries: serpQueries,
    tools_used: toolsUsed,
    tools_skipped: toolsSkipped,
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
  const email = args.find((arg) => !arg.startsWith("--"));
  const result = await runCompanyCheck(email);
  if (shouldSave) {
    result.storage = storeResult(result);
  }
  
  // Kirim ke Slack jika environment-nya sudah diset
  await sendToSlack(result.telegram_report);
  
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
