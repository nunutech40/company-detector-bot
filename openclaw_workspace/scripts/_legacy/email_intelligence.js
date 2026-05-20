#!/usr/bin/env node
"use strict";

const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
]);

const DISPOSABLE_HINTS = [
  "mailinator",
  "tempmail",
  "10minutemail",
  "guerrillamail",
  "yopmail",
  "trashmail",
  "getnada",
  "sharklasers",
];

const ROLE_LOCALS = new Set([
  "admin",
  "billing",
  "contact",
  "cs",
  "founder",
  "hello",
  "help",
  "hr",
  "info",
  "marketing",
  "office",
  "sales",
  "security",
  "support",
  "team",
]);

function normalizeEmail(input) {
  return String(input || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function analyzeEmail(input) {
  const email = normalizeEmail(input);

  if (!isValidEmail(email)) {
    return {
      ok: false,
      input: input || null,
      error: "invalid_email",
      evidence: [
        {
          source_type: "input_validation",
          reliability: "high",
          claim: "Input is not a valid email address.",
          value: input || null,
          confidence_delta: -30,
        },
      ],
    };
  }

  const [local, domain] = email.split("@");
  const isFreeEmail = FREE_DOMAINS.has(domain);
  const isDisposable = DISPOSABLE_HINTS.some((hint) => domain.includes(hint));
  const isRoleEmail = ROLE_LOCALS.has(local);
  const tld = domain.split(".").pop();

  let initialSuspicion = "possible_company_domain";
  if (isDisposable) initialSuspicion = "suspicious_or_invalid";
  else if (isFreeEmail) initialSuspicion = "free_email_needs_more_evidence";

  const tags = [];
  if (isFreeEmail) tags.push("free_email_provider");
  if (isDisposable) tags.push("disposable_email_hint");
  if (isRoleEmail) tags.push("role_email");
  if (!isFreeEmail && !isDisposable) tags.push("custom_domain");
  if (tld) tags.push(`tld_${tld}`);

  const evidence = [
    {
      source_type: "email_domain",
      reliability: "high",
      claim: isFreeEmail
        ? "Email uses a known free/personal provider."
        : "Email uses a custom domain, not a known free provider.",
      value: domain,
      confidence_delta: isFreeEmail ? -30 : 30,
    },
  ];

  if (isRoleEmail) {
    evidence.push({
      source_type: "email_local_part",
      reliability: "medium",
      claim: "Email local part is a role/contact mailbox.",
      value: local,
      confidence_delta: 10,
    });
  }

  if (isDisposable) {
    evidence.push({
      source_type: "email_domain",
      reliability: "high",
      claim: "Domain matches disposable email hints.",
      value: domain,
      confidence_delta: -40,
    });
  }

  return {
    ok: true,
    email,
    local,
    domain,
    tld,
    is_free_email: isFreeEmail,
    is_disposable: isDisposable,
    is_role_email: isRoleEmail,
    tags,
    initial_suspicion: initialSuspicion,
    evidence,
  };
}

if (require.main === module) {
  const result = analyzeEmail(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  analyzeEmail,
  FREE_DOMAINS,
};
