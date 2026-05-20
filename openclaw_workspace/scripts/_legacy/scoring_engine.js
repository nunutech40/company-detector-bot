#!/usr/bin/env node
"use strict";

function scoreEvidence(evidence) {
  return evidence.reduce((sum, item) => sum + Number(item.confidence_delta || 0), 0);
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceLabel(score) {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function classify({ email_intelligence, domain_checker, confidence_score, register_input }) {
  if (!email_intelligence || !email_intelligence.ok || email_intelligence.is_disposable) {
    return "suspicious_or_invalid";
  }
  if (email_intelligence.is_free_email) {
    if (register_input && register_input.brand_name) {
      return "unknown_needs_more_evidence";
    }
    return confidence_score >= 45 ? "unknown_needs_more_evidence" : "likely_personal_email";
  }
  if (domain_checker && domain_checker.website_active) {
    return "possible_company_affiliated";
  }
  if (confidence_score >= 45) {
    return "possible_company_affiliated";
  }
  return "unknown_needs_more_evidence";
}

function recommendedAction(classification) {
  const actions = {
    possible_company_affiliated: "route_company_associated",
    likely_personal_email: "continue_as_personal_or_unknown",
    suspicious_or_invalid: "risk_or_format_review",
    unknown_needs_more_evidence: "store_unknown_retry_later",
  };
  return actions[classification] || actions.unknown_needs_more_evidence;
}

function scoreCompanyEvidence(input) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const baseScore = Number.isFinite(input.base_score) ? input.base_score : 35;
  const confidenceScore = clampScore(baseScore + scoreEvidence(evidence));
  const classification = classify({
    email_intelligence: input.email_intelligence,
    domain_checker: input.domain_checker,
    confidence_score: confidenceScore,
    register_input: input.register_input,
  });

  return {
    ok: true,
    classification,
    company_detected: classification === "possible_company_affiliated",
    confidence_score: confidenceScore,
    confidence_label: confidenceLabel(confidenceScore),
    automation_action: recommendedAction(classification),
    owner_claim_allowed: false,
    score_breakdown: {
      base_score: baseScore,
      evidence_delta: scoreEvidence(evidence),
      final_score: confidenceScore,
    },
  };
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  const input = raw.trim() ? JSON.parse(raw) : {};
  console.log(JSON.stringify(scoreCompanyEvidence(input), null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  scoreCompanyEvidence,
  confidenceLabel,
};
