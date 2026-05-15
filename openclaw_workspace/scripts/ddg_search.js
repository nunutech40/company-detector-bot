#!/usr/bin/env node
"use strict";

function cleanHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function searchDuckDuckGo(query, options = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    return { ok: false, error: "missing_query", query: cleanQuery };
  }

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      signal: AbortSignal.timeout(options.timeoutMs || 15000),
    });

    if (!response.ok) {
      return { ok: false, error: `http_${response.status}`, query: cleanQuery };
    }

    const html = await response.text();
    const results = [];

    const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
    const urlRegex = /<a class="result__url" href="([^"]+)">/g;
    const titleRegex = /<h2 class="result__title">[\s\S]*?<a[^>]*>(.*?)<\/a>/g;

    let matchSnippet, matchUrl, matchTitle;
    const limit = options.limit || 5;
    let count = 0;

    while (
      (matchSnippet = regex.exec(html)) !== null &&
      (matchUrl = urlRegex.exec(html)) !== null &&
      (matchTitle = titleRegex.exec(html)) !== null &&
      count < limit
    ) {
      let realUrl = matchUrl[1];
      if (realUrl.includes("uddg=")) {
        try {
          const urlParam = new URL(realUrl, "https://duckduckgo.com").searchParams.get("uddg");
          if (urlParam) realUrl = urlParam;
        } catch (error) {
          // Keep the DDG redirect URL if decoding fails.
        }
      }

      results.push({
        title: cleanHtml(matchTitle[1]),
        url: realUrl,
        snippet: cleanHtml(matchSnippet[1]),
      });
      count++;
    }

    return {
      ok: true,
      query: cleanQuery,
      results,
      reliability: "low",
    };
  } catch (error) {
    return { ok: false, error: error.message, query: cleanQuery };
  }
}

if (require.main === module) {
  const query = process.argv.slice(2).join(" ");
  searchDuckDuckGo(query).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  });
}

module.exports = {
  searchDuckDuckGo,
};
