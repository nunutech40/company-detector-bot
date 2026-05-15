#!/usr/bin/env node

const query = process.argv.slice(2).join(' ');

if (!query) {
  console.log(JSON.stringify({ ok: false, error: 'missing_query' }));
  process.exit(1);
}

async function search() {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!response.ok) {
      console.log(JSON.stringify({ ok: false, error: `http_${response.status}` }));
      return;
    }
    
    const html = await response.text();
    const results = [];
    
    // Regex parsing sederhana untuk MVP HTML DuckDuckGo
    const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
    const urlRegex = /<a class="result__url" href="([^"]+)">/g;
    const titleRegex = /<h2 class="result__title">[\s\S]*?<a[^>]*>(.*?)<\/a>/g;
    
    let matchSnippet, matchUrl, matchTitle;
    let limit = 5;
    let count = 0;
    
    // Kita iterasi barengan. Ini asumsi struktur DuckDuckGo HTML konsisten per result item.
    while (
      (matchSnippet = regex.exec(html)) !== null && 
      (matchUrl = urlRegex.exec(html)) !== null &&
      (matchTitle = titleRegex.exec(html)) !== null &&
      count < limit
    ) {
      // Bersihkan tag HTML (biasanya <b>) dari snippet dan title
      const cleanSnippet = matchSnippet[1].replace(/<[^>]+>/g, '').trim();
      const cleanTitle = matchTitle[1].replace(/<[^>]+>/g, '').trim();
      
      // DuckDuckGo URL redirect format: //duckduckgo.com/l/?uddg=ENCODED_URL
      let realUrl = matchUrl[1];
      if (realUrl.includes('uddg=')) {
        try {
          const urlParam = new URL(realUrl, 'https://duckduckgo.com').searchParams.get('uddg');
          if (urlParam) realUrl = urlParam;
        } catch(e) {}
      }
      
      results.push({
        title: cleanTitle,
        url: realUrl,
        snippet: cleanSnippet
      });
      count++;
    }
    
    console.log(JSON.stringify({
      ok: true,
      query: query,
      results: results
    }, null, 2));
    
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
  }
}

search();
