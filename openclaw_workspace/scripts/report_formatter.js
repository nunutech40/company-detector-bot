#!/usr/bin/env node
"use strict";

function bulletList(items, fallback = "- Tidak ada.") {
  const filtered = items.filter(Boolean);
  if (!filtered.length) return fallback;
  return filtered.map((item) => `- ${item}`).join("\n");
}

function renderTelegramReport(result) {
  const success = [];
  const failed = [];
  const skipped = [];

  if (result.email_intelligence.ok) {
    success.push("Email berhasil diparse.");
    success.push(`Domain \`${result.email_intelligence.domain}\` berhasil diekstrak.`);
    success.push(
      result.email_intelligence.is_free_email
        ? "Domain dikenali sebagai free email provider."
        : "Domain dikenali sebagai custom domain, bukan free email provider."
    );
    if (result.email_intelligence.is_role_email) {
      success.push("Local part terdeteksi sebagai role/contact mailbox.");
    }
  } else {
    failed.push("Email tidak valid.");
  }

  if (result.domain_checker) {
    if (result.domain_checker.ok) {
      success.push(`DNS/domain check selesai: MX ${result.domain_checker.mx_status}.`);
      if (result.domain_checker.website_active) {
        success.push("Website domain terlihat aktif.");
      } else {
        failed.push("Website domain tidak aktif/tidak terbaca pada MVP check.");
      }
    } else {
      failed.push(`Domain checker gagal: ${result.domain_checker.error}.`);
    }
  } else {
    skipped.push("Domain checker dilewati karena email memakai free provider atau input invalid.");
  }

  if (result.website_crawler) {
    if (result.website_crawler.ok && result.website_crawler.active_page_count > 0) {
      success.push(`Website crawler membaca ${result.website_crawler.active_page_count} halaman aktif.`);
    } else {
      skipped.push("Website crawler tidak menemukan halaman aktif yang terbaca.");
    }
  }

  for (const item of result.tools_skipped) {
    skipped.push(`${item.tool}: ${item.reason}.`);
  }

  for (const item of result.tool_errors || []) {
    failed.push(`${item.tool}: ${item.error}.`);
  }

  const evidence = result.evidence.map((item) => {
    const value = Array.isArray(item.value) ? item.value.join(", ") : item.value;
    return `${item.claim}${value ? ` (${value})` : ""}`;
  });

  return [
    "Company Detection MVP Report",
    "",
    "Input:",
    `- Email: ${result.input.email}`,
    "",
    "Kesimpulan final sementara:",
    result.summary,
    `Classification: ${result.classification}`,
    `Confidence: ${result.confidence_label} (${result.confidence_score}/100)`,
    "",
    "Proses berhasil:",
    bulletList(success),
    "",
    "Proses gagal:",
    bulletList(failed),
    "",
    "Proses dilewati / belum tersedia:",
    bulletList(skipped),
    "",
    "Evidence:",
    bulletList(evidence),
    "",
    "Rekomendasi automation:",
    result.recommendation,
  ].join("\n");
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
  const result = raw.trim() ? JSON.parse(raw) : {};
  console.log(renderTelegramReport(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  renderTelegramReport,
};
