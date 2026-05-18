# Skill: LLM Task Structured Extraction

Skill ini mengajarkan AI cara pakai `llm-task` untuk extract structured data dari teks mentah.

## Status
⏳ PLACEHOLDER — implementasi besok

## Kapan dipakai

Setelah `web_search` atau `web_fetch` mengembalikan teks mentah yang perlu di-extract
menjadi JSON terstruktur. Contoh:

- Teks: "Tatak Subekti - Owner at Naway Store, Jakarta Utara, WA: 085xxx"
- Output JSON: `{"name": "Tatak Subekti", "role": "owner", "company": "Naway Store", "location": "Jakarta Utara", "phone": "085xxx"}`

## Rencana implementasi

```
llm-task(
  prompt: "Extract business entity information from this text. Return only JSON.",
  input: "<teks mentah dari search/fetch>",
  schema: {
    type: "object",
    properties: {
      name: {type: "string"},
      role: {type: "string", enum: ["founder", "owner", "ceo", "director", "employee", "unknown"]},
      company: {type: "string"},
      location: {type: "string"},
      phone: {type: "string"},
      social_media: {type: "array", items: {type: "string"}},
      confidence: {type: "string", enum: ["high", "medium", "low"]}
    }
  }
)
```

## Keuntungan vs parsing manual

- Output selalu valid JSON (schema-validated)
- Bisa pakai model berbeda (misal GPT-4 untuk extraction, MiniMax untuk reasoning)
- Tidak ada hallucination karena input adalah teks nyata dari tool
- Data langsung bisa disimpan ke DB karena sudah structured
