package crawler

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"company-detector/go-service/internal/model"
)

var candidatePaths = []string{"/", "/about", "/about-us", "/team", "/founders", "/contact", "/pricing", "/careers", "/privacy", "/terms"}

type Options struct {
	HTTPClient *http.Client
	BaseURL    string
	MaxPages   int
	Timeout    time.Duration
}

func Crawl(ctx context.Context, domain string, options Options) model.WebsiteCrawler {
	domain = strings.ToLower(strings.TrimSpace(domain))
	if !regexp.MustCompile(`^[a-z0-9.-]+\.[a-z]{2,}$`).MatchString(domain) && options.BaseURL == "" {
		return model.WebsiteCrawler{OK: false, Domain: domain, Error: "invalid_domain", Pages: []model.CrawlPage{}, Evidence: []model.EvidenceItem{}}
	}
	maxPages := options.MaxPages
	if maxPages <= 0 || maxPages > len(candidatePaths) {
		maxPages = 6
	}
	paths := candidatePaths[:maxPages]
	pages := []model.CrawlPage{}
	for _, path := range paths {
		pages = append(pages, fetchPage(ctx, domain, path, options))
	}
	active := []model.CrawlPage{}
	signalPages := []model.CrawlPage{}
	for _, page := range pages {
		if page.Active {
			active = append(active, page)
		}
		if page.Active && len(page.Signals) > 0 {
			signalPages = append(signalPages, page)
		}
	}
	evidence := []model.EvidenceItem{}
	if len(active) > 0 {
		values := []string{}
		for _, page := range active {
			values = append(values, page.Path)
		}
		evidence = append(evidence, model.EvidenceItem{SourceType: "website_crawler", SourceURL: firstURL(active[0]), Reliability: "medium", Claim: "Website crawler found readable active pages.", Value: values, ConfidenceDelta: min(15, len(active)*3)})
	}
	if len(signalPages) > 0 {
		values := []string{}
		for _, page := range signalPages {
			values = append(values, page.Path+":"+strings.Join(page.Signals, "|"))
		}
		evidence = append(evidence, model.EvidenceItem{SourceType: "website_crawler", SourceURL: firstURL(signalPages[0]), Reliability: "medium", Claim: "Website pages contain business/company signals.", Value: values, ConfidenceDelta: min(20, len(signalPages)*5)})
	}
	return model.WebsiteCrawler{OK: true, Domain: domain, CandidatePaths: paths, ActivePageCount: len(active), SignalPageCount: len(signalPages), Pages: pages, Evidence: evidence}
}

func fetchPage(ctx context.Context, domain, path string, options Options) model.CrawlPage {
	started := time.Now()
	base := options.BaseURL
	if base == "" {
		base = "https://" + domain
	}
	url := strings.TrimRight(base, "/") + path
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout(options.Timeout, 7*time.Second)}
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("user-agent", "CompanyDetectionBot/0.1 (+https://example.internal/company-detection)")
	resp, err := client.Do(req)
	if err != nil {
		return model.CrawlPage{OK: false, URL: url, Path: path, Active: false, Error: normalizeErr(err), LatencyMS: elapsed(started)}
	}
	defer resp.Body.Close()
	contentType := resp.Header.Get("content-type")
	active := resp.StatusCode >= 200 && resp.StatusCode < 400
	body := ""
	if active && (strings.Contains(contentType, "text/html") || strings.Contains(contentType, "text/plain")) {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
		body = string(data)
	}
	return model.CrawlPage{OK: true, URL: url, FinalURL: resp.Request.URL.String(), Path: path, Status: resp.StatusCode, Active: active, ContentType: contentType, Title: extractTag(body, `(?is)<title[^>]*>(.*?)</title>`), MetaDescription: extractTag(body, `(?is)<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>`), Signals: extractSignals(body), TextSample: truncate(cleanText(body), 900), LatencyMS: elapsed(started)}
}

func extractSignals(html string) []string {
	text := strings.ToLower(cleanText(html))
	patterns := map[string]*regexp.Regexp{
		"company_terms": regexp.MustCompile(`\b(company|business|platform|solution|service|customer|client|enterprise|commerce|e-commerce)\b`),
		"team_terms":    regexp.MustCompile(`\b(team|founder|co-founder|leadership|career|jobs|hiring)\b`),
		"legal_terms":   regexp.MustCompile(`\b(privacy policy|terms of service|terms and conditions|legal)\b`),
		"contact_terms": regexp.MustCompile(`\b(contact|support|sales|hello@|info@)\b`),
	}
	order := []string{"company_terms", "team_terms", "legal_terms", "contact_terms"}
	out := []string{}
	for _, key := range order {
		if patterns[key].MatchString(text) {
			out = append(out, key)
		}
	}
	return out
}

func cleanText(value string) string {
	value = regexp.MustCompile(`(?is)<script.*?</script>`).ReplaceAllString(value, " ")
	value = regexp.MustCompile(`(?is)<style.*?</style>`).ReplaceAllString(value, " ")
	value = regexp.MustCompile(`(?s)<[^>]+>`).ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(value), " ")
}

func extractTag(html, pattern string) string {
	match := regexp.MustCompile(pattern).FindStringSubmatch(html)
	if len(match) < 2 {
		return ""
	}
	return truncate(strings.Join(strings.Fields(match[1]), " "), 220)
}

func firstURL(page model.CrawlPage) string {
	if page.FinalURL != "" {
		return page.FinalURL
	}
	return page.URL
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func timeout(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

func elapsed(start time.Time) int64 {
	return time.Since(start).Milliseconds()
}

func normalizeErr(err error) string {
	if err == nil {
		return ""
	}
	if strings.Contains(err.Error(), "deadline") || strings.Contains(err.Error(), "timeout") {
		return "timeout"
	}
	return err.Error()
}
