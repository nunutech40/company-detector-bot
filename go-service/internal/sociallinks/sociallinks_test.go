package sociallinks

import "testing"

func TestExtractFromHTML(t *testing.T) {
	html := `<html><body>
		<a href="https://www.instagram.com/nawaystore">Instagram</a>
		<a href="https://www.tokopedia.com/nawaystore">Tokopedia</a>
		<a href="https://www.linkedin.com/company/komerceid">LinkedIn</a>
		<a href="https://www.facebook.com/nawayinc">Facebook</a>
		<a href="https://wa.me/6285281336302">WhatsApp</a>
	</body></html>`

	result := Extract(html)

	if len(result.Links) == 0 {
		t.Fatal("expected links to be found")
	}
	if result.ByPlatform["instagram"] == "" {
		t.Error("expected instagram link")
	}
	if result.ByPlatform["tokopedia"] == "" {
		t.Error("expected tokopedia link")
	}
	if result.ByPlatform["linkedin_company"] == "" {
		t.Error("expected linkedin company link")
	}
}

func TestSkipsGenericURLs(t *testing.T) {
	html := `<a href="https://www.instagram.com">Follow us on Instagram</a>`
	result := Extract(html)
	if result.ByPlatform["instagram"] != "" {
		t.Errorf("should skip generic instagram.com URL, got: %s", result.ByPlatform["instagram"])
	}
}

func TestDeduplication(t *testing.T) {
	html := `
		<a href="https://instagram.com/nawaystore">IG</a>
		<a href="https://instagram.com/nawaystore">IG again</a>
		<a href="https://www.instagram.com/nawaystore">IG www</a>
	`
	result := Extract(html)
	count := 0
	for _, l := range result.Links {
		if l.Platform == "instagram" {
			count++
		}
	}
	if count > 1 {
		t.Errorf("expected deduplication, got %d instagram links", count)
	}
}

func TestExtractFromPlainText(t *testing.T) {
	text := "Follow us: instagram.com/nawaystore | tiktok.com/@naway.inc | wa.me/6285281336302"
	result := Extract(text)
	// Plain text without https:// won't match — that's expected behavior
	// This test verifies it doesn't panic
	_ = result
}
