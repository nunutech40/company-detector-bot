#!/usr/bin/env node
"use strict";

function cleanHtml(html, limit = 5000) {
  return String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

async function scrapeUrl(url, options = {}) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    return { ok: false, error: "missing_url", url: null };
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      signal: AbortSignal.timeout(options.timeoutMs || 10000),
    });

    if (!response.ok) {
      return { ok: false, error: `http_${response.status}`, url: targetUrl };
    }

    const html = await response.text();

    return {
      ok: true,
      url: targetUrl,
      final_url: response.url,
      content_snippet: cleanHtml(html, options.limit || 5000),
      reliability: "low",
    };
  } catch (error) {
    return { ok: false, error: error.message, url: targetUrl };
  }
}

if (require.main === module) {
  scrapeUrl(process.argv[2]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  });
}

module.exports = {
  scrapeUrl,
};
