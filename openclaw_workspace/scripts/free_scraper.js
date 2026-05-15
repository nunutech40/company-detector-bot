#!/usr/bin/env node

const url = process.argv[2];

if (!url) {
  console.log(JSON.stringify({ ok: false, error: 'missing_url' }));
  process.exit(1);
}

async function scrape() {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      console.log(JSON.stringify({ ok: false, error: `http_${response.status}` }));
      return;
    }
    
    const html = await response.text();
    
    // Sangat sederhana: buang script, style, lalu hapus tag HTML. 
    // Untuk production sebaiknya pakai parser seperti cheerio atau mozilla/readability.
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
      
    // Ambil max 5000 karakter agar tidak membebani context token AI
    text = text.substring(0, 5000);
    
    console.log(JSON.stringify({
      ok: true,
      url: url,
      content_snippet: text
    }, null, 2));
    
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
  }
}

scrape();
