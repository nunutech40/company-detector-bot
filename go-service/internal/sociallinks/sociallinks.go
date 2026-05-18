// Package sociallinks extracts social media profile links from HTML content.
// Used by the AI reasoning loop to find social media presence from a company website
// without needing to manually parse HTML.
package sociallinks

import (
	"regexp"
	"strings"
)

// SocialLink represents a found social media link.
type SocialLink struct {
	Platform string // "instagram", "linkedin", "facebook", "twitter", "tiktok", "youtube", "tokopedia", "shopee"
	URL      string
}

// Result holds all social links found in the HTML.
type Result struct {
	Links      []SocialLink
	ByPlatform map[string]string // platform → first URL found
}

// platformPatterns maps platform names to URL patterns.
var platformPatterns = []struct {
	platform string
	pattern  *regexp.Regexp
}{
	{"instagram", regexp.MustCompile(`(?i)https?://(?:www\.)?instagram\.com/[a-zA-Z0-9._]+/?`)},
	{"linkedin_company", regexp.MustCompile(`(?i)https?://(?:www\.)?linkedin\.com/company/[a-zA-Z0-9._-]+/?`)},
	{"linkedin_person", regexp.MustCompile(`(?i)https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9._-]+/?`)},
	{"facebook", regexp.MustCompile(`(?i)https?://(?:www\.)?facebook\.com/[a-zA-Z0-9._-]+/?`)},
	{"twitter", regexp.MustCompile(`(?i)https?://(?:www\.)?(?:twitter|x)\.com/[a-zA-Z0-9._]+/?`)},
	{"tiktok", regexp.MustCompile(`(?i)https?://(?:www\.)?tiktok\.com/@[a-zA-Z0-9._]+/?`)},
	{"youtube", regexp.MustCompile(`(?i)https?://(?:www\.)?youtube\.com/(?:channel|c|@)[a-zA-Z0-9._-]+/?`)},
	{"tokopedia", regexp.MustCompile(`(?i)https?://(?:www\.)?tokopedia\.com/[a-zA-Z0-9._-]+/?`)},
	{"shopee", regexp.MustCompile(`(?i)https?://(?:www\.)?shopee\.co\.id/[a-zA-Z0-9._-]+/?`)},
	{"bukalapak", regexp.MustCompile(`(?i)https?://(?:www\.)?bukalapak\.com/[a-zA-Z0-9._-]+/?`)},
	{"lazada", regexp.MustCompile(`(?i)https?://(?:www\.)?lazada\.co\.id/[a-zA-Z0-9._-]+/?`)},
	{"whatsapp", regexp.MustCompile(`(?i)https?://(?:wa\.me|api\.whatsapp\.com/send)[/?][0-9]+`)},
}

// Extract finds all social media links in the given HTML or text content.
// Input can be raw HTML or plain text — both work.
func Extract(content string) Result {
	seen := map[string]bool{}
	links := []SocialLink{}
	byPlatform := map[string]string{}

	for _, pp := range platformPatterns {
		matches := pp.pattern.FindAllString(content, -1)
		for _, match := range matches {
			// Normalize: remove trailing slash, lowercase, remove www.
			normalized := strings.TrimRight(strings.ToLower(match), "/")
			normalized = strings.Replace(normalized, "://www.", "://", 1)
			if seen[normalized] {
				continue
			}
			// Skip generic/homepage URLs that are too short
			if isTooGeneric(normalized, pp.platform) {
				continue
			}
			seen[normalized] = true
			links = append(links, SocialLink{Platform: pp.platform, URL: normalized})
			if _, exists := byPlatform[pp.platform]; !exists {
				byPlatform[pp.platform] = normalized
			}
		}
	}

	return Result{Links: links, ByPlatform: byPlatform}
}

// isTooGeneric returns true if the URL is just the platform homepage without a profile path.
func isTooGeneric(url, platform string) bool {
	genericURLs := map[string][]string{
		"instagram":        {"instagram.com", "www.instagram.com"},
		"linkedin_company": {"linkedin.com/company", "www.linkedin.com/company"},
		"linkedin_person":  {"linkedin.com/in", "www.linkedin.com/in"},
		"facebook":         {"facebook.com", "www.facebook.com"},
		"twitter":          {"twitter.com", "x.com", "www.twitter.com", "www.x.com"},
		"tiktok":           {"tiktok.com", "www.tiktok.com"},
		"youtube":          {"youtube.com", "www.youtube.com"},
		"tokopedia":        {"tokopedia.com", "www.tokopedia.com"},
		"shopee":           {"shopee.co.id", "www.shopee.co.id"},
	}
	for _, generic := range genericURLs[platform] {
		if strings.HasSuffix(url, generic) || url == "https://"+generic || url == "http://"+generic {
			return true
		}
	}
	return false
}
