#!/usr/bin/env node
"use strict";

function cleanString(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  return cleanString(value).replace(/[^\d+]/g, "");
}

function maskPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return null;
  if (phone.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

function normalizeRegisterInput(input) {
  const source = typeof input === "string" ? { email: input } : (input || {});

  const normalized = {
    email: cleanString(source.email || source.Email || source.mail).toLowerCase(),
    full_name: cleanString(source.full_name || source.fullName || source.name || source.nama),
    no_hp: normalizePhone(source.no_hp || source.noHp || source.phone || source.hp),
    brand_name: cleanString(source.brand_name || source.brandName || source.company_field || source.company || source.brand),
  };

  const ignoredFields = [];
  for (const field of ["username", "signup_source", "referrer", "country", "ip_country"]) {
    if (source[field]) ignoredFields.push(field);
  }

  return {
    ...normalized,
    phone_masked: maskPhone(normalized.no_hp),
    ignored_fields: ignoredFields,
  };
}

if (require.main === module) {
  const raw = process.argv.slice(2).join(" ");
  const input = raw && raw.trim().startsWith("{") ? JSON.parse(raw) : raw;
  console.log(JSON.stringify(normalizeRegisterInput(input), null, 2));
}

module.exports = {
  normalizeRegisterInput,
  maskPhone,
};
