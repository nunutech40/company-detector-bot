// Package search provides a multi-provider search adapter with automatic fallback.
//
// Provider priority (highest to lowest):
//  1. Google Custom Search API  — reliable, 100 free queries/day, needs GOOGLE_CSE_KEY + GOOGLE_CSE_ID
//  2. Brave Search API          — reliable, ~$5 credit/month, needs BRAVE_SEARCH_API_KEY
//  3. Bing HTML scraping        — free, no key, more tolerant than DDG
//  4. DuckDuckGo HTML scraping  — free, no key, fragile (blocked by some ISPs)
//
// AI orchestrator should call Search() and let the adapter handle fallback automatically.
// Each provider reports its availability status so the AI can see which ones are configured.
package search

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"company-detector/go-service/internal/model"
)

// ProviderStatus describes the availability of a search provider.
type ProviderStatus struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// Options for the search adapter.
type Options struct {
	HTTPClient *http.Client
	Limit      int
	Timeout    time.Duration
	// Override endpoints for testing
	GoogleEndpoint string
	BraveEndpoint  string
	BingEndpoint   string
	DDGEndpoint    string
}

// Search runs the query through providers in priority order, returning the first success.
// If all providers fail, returns the last error with ok=false and a summary of what was tried.
func Search(ctx context.Context, query string, options Options) model.SearchResponse {
	type providerFn struct {
		name string
		fn   func(context.Context, string, Options) model.SearchResponse
	}
	providers := []providerFn{
		{"google_cse", googleCSE},
		{"brave_search", braveSearch},
		{"bing_html", bingHTML},
		{"ddg_html", DuckDuckGo},
	}
	tried := []string{}
	var last model.SearchResponse
	for _, p := range providers {
		result := p.fn(ctx, query, options)
		if result.OK {
			result.Provider = p.name
			return result
		}
		tried = append(tried, p.name+"("+result.Error+")")
		last = result
		if ctx.Err() != nil {
			break
		}
	}
	last.Error = "all_providers_failed: " + strings.Join(tried, "; ")
	return last
}

// Providers returns the availability status of all configured providers.
// AI can use this to understand which providers are ready and which need setup.
func Providers() []ProviderStatus {
	return []ProviderStatus{
		{
			Name:      "google_cse",
			Available: os.Getenv("GOOGLE_CSE_KEY") != "" && os.Getenv("GOOGLE_CSE_ID") != "",
			Reason:    providerReason("google_cse"),
		},
		{
			Name:      "brave_search",
			Available: os.Getenv("BRAVE_SEARCH_API_KEY") != "",
			Reason:    providerReason("brave_search"),
		},
		{
			Name:      "bing_html",
			Available: true,
			Reason:    "free HTML scraping, no key required — fragile, may be blocked",
		},
		{
			Name:      "ddg_html",
			Available: true,
			Reason:    "free HTML scraping, no key required — most fragile, often blocked by ISP",
		},
	}
}

func providerReason(name string) string {
	switch name {
	case "google_cse":
		if os.Getenv("GOOGLE_CSE_KEY") == "" || os.Getenv("GOOGLE_CSE_ID") == "" {
			return "not configured — set GOOGLE_CSE_KEY and GOOGLE_CSE_ID (100 free queries/day)"
		}
		return "configured — 100 free queries/day"
	case "brave_search":
		if os.Getenv("BRAVE_SEARCH_API_KEY") == "" {
			return "not configured — set BRAVE_SEARCH_API_KEY (~$5 credit/month free)"
		}
		return "configured"
	default:
		return ""
	}
}

// ── Provider 1: Google Custom Search API ─────────────────────────────────────

func googleCSE(ctx context.Context, query string, options Options) model.SearchResponse {
	key := os.Getenv("GOOGLE_CSE_KEY")
	cx := os.Getenv("GOOGLE_CSE_ID")
	if key == "" || cx == "" {
		return model.SearchResponse{OK: false, Query: query, Error: "google_cse_not_configured: set GOOGLE_CSE_KEY and GOOGLE_CSE_ID"}
	}
	endpoint := options.GoogleEndpoint
	if endpoint == "" {
		endpoint = "https://www.googleapis.com/customsearch/v1"
	}
	limit := options.Limit
	if limit <= 0 || limit > 10 {
		limit = 5 // Google CSE max 10 per request
	}
	client := httpClient(options)
	reqURL := endpoint + "?key=" + url.QueryEscape(key) +
		"&cx=" + url.QueryEscape(cx) +
		"&q=" + url.QueryEscape(query) +
		"&num=" + itoa(limit)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	resp, err := client.Do(req)
	if err != nil {
		return model.SearchResponse{OK: false, Query: query, Error: "google_cse: " + normalizeErr(err)}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 {
		return model.SearchResponse{OK: false, Query: query, Error: "google_cse: daily quota exceeded (100/day free limit)"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return model.SearchResponse{OK: false, Query: query, Error: "google_cse: " + resp.Status}
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	return parseGoogleCSE(query, data)
}

func parseGoogleCSE(query string, data []byte) model.SearchResponse {
	var body struct {
		Items []struct {
			Title   string `json:"title"`
			Link    string `json:"link"`
			Snippet string `json:"snippet"`
		} `json:"items"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		return model.SearchResponse{OK: false, Query: query, Error: "google_cse: parse error"}
	}
	results := []model.SearchResult{}
	for _, item := range body.Items {
		if item.Link == "" {
			continue
		}
		results = append(results, model.SearchResult{
			Title:   item.Title,
			URL:     item.Link,
			Snippet: item.Snippet,
		})
	}
	return model.SearchResponse{OK: true, Query: query, Results: results}
}

// ── Provider 2: Brave Search API ─────────────────────────────────────────────

func braveSearch(ctx context.Context, query string, options Options) model.SearchResponse {
	key := os.Getenv("BRAVE_SEARCH_API_KEY")
	if key == "" {
		return model.SearchResponse{OK: false, Query: query, Error: "brave_search_not_configured: set BRAVE_SEARCH_API_KEY"}
	}
	endpoint := options.BraveEndpoint
	if endpoint == "" {
		endpoint = "https://api.search.brave.com/res/v1/web/search"
	}
	limit := options.Limit
	if limit <= 0 {
		limit = 5
	}
	client := httpClient(options)
	reqURL := endpoint + "?q=" + url.QueryEscape(query) + "&count=" + itoa(limit)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("X-Subscription-Token", key)
	resp, err := client.Do(req)
	if err != nil {
		return model.SearchResponse{OK: false, Query: query, Error: "brave_search: " + normalizeErr(err)}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 {
		return model.SearchResponse{OK: false, Query: query, Error: "brave_search: rate limited or quota exceeded"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return model.SearchResponse{OK: false, Query: query, Error: "brave_search: " + resp.Status}
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	return parseBraveSearch(query, data)
}

func parseBraveSearch(query string, data []byte) model.SearchResponse {
	var body struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		return model.SearchResponse{OK: false, Query: query, Error: "brave_search: parse error"}
	}
	results := []model.SearchResult{}
	for _, item := range body.Web.Results {
		if item.URL == "" {
			continue
		}
		results = append(results, model.SearchResult{
			Title:   item.Title,
			URL:     item.URL,
			Snippet: item.Description,
		})
	}
	return model.SearchResponse{OK: true, Query: query, Results: results}
}

// ── Provider 3: Bing HTML scraping ───────────────────────────────────────────

func bingHTML(ctx context.Context, query string, options Options) model.SearchResponse {
	endpoint := options.BingEndpoint
	if endpoint == "" {
		endpoint = "https://www.bing.com/search"
	}
	limit := options.Limit
	if limit <= 0 {
		limit = 5
	}
	client := httpClient(options)
	reqURL := endpoint + "?q=" + url.QueryEscape(query)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	// Use a realistic browser UA — Bing is more tolerant but still checks UA
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	resp, err := client.Do(req)
	if err != nil {
		return model.SearchResponse{OK: false, Query: query, Error: "bing_html: " + normalizeErr(err)}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return model.SearchResponse{OK: false, Query: query, Error: "bing_html: " + resp.Status}
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	results := parseBingHTML(string(data), limit)
	if len(results) == 0 {
		return model.SearchResponse{OK: false, Query: query, Error: "bing_html: no results parsed (may be blocked or CAPTCHA)"}
	}
	return model.SearchResponse{OK: true, Query: query, Results: results}
}

func parseBingHTML(html string, limit int) []model.SearchResult {
	results := []model.SearchResult{}
	// Bing result links are in <h2><a href="...">title</a></h2> inside .b_algo
	reTitle := regexp.MustCompile(`(?is)<h2[^>]*>.*?<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)</a>`)
	reSnippet := regexp.MustCompile(`(?is)<p[^>]*class=["'][^"']*b_lineclamp[^"']*["'][^>]*>(.*?)</p>`)
	snippets := reSnippet.FindAllStringSubmatch(html, -1)
	for i, match := range reTitle.FindAllStringSubmatch(html, -1) {
		link := match[1]
		title := cleanHTML(match[2])
		if link == "" || title == "" || strings.HasPrefix(link, "#") || strings.Contains(link, "bing.com") {
			continue
		}
		snippet := ""
		if i < len(snippets) {
			snippet = cleanHTML(snippets[i][1])
		}
		results = append(results, model.SearchResult{Title: title, URL: link, Snippet: snippet})
		if len(results) >= limit {
			break
		}
	}
	return results
}

// ── Provider 4: DuckDuckGo HTML scraping (existing) ──────────────────────────

func DuckDuckGo(ctx context.Context, query string, options Options) model.SearchResponse {
	endpoint := options.DDGEndpoint
	if endpoint == "" {
		endpoint = "https://duckduckgo.com/html/"
	}
	limit := options.Limit
	if limit <= 0 {
		limit = 5
	}
	client := httpClient(options)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?q="+url.QueryEscape(query), nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; CompanyDetectionBot/1.0)")
	resp, err := client.Do(req)
	if err != nil {
		return model.SearchResponse{OK: false, Error: normalizeErr(err), Query: query}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return model.SearchResponse{OK: false, Error: resp.Status, Query: query}
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	results := parseDDGResults(string(data), limit)
	if len(results) == 0 {
		return model.SearchResponse{OK: false, Query: query, Error: "ddg_html: no results parsed (may be blocked by ISP or CAPTCHA)"}
	}
	return model.SearchResponse{OK: true, Query: query, Results: results}
}

func parseDDGResults(html string, limit int) []model.SearchResult {
	results := []model.SearchResult{}
	re := regexp.MustCompile(`(?is)<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>(.*?)</a>`)
	for _, match := range re.FindAllStringSubmatch(html, -1) {
		title := cleanHTML(match[2])
		link := decodeDDG(match[1])
		if title == "" || link == "" {
			continue
		}
		results = append(results, model.SearchResult{Title: title, URL: link})
		if len(results) >= limit {
			break
		}
	}
	return results
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func httpClient(options Options) *http.Client {
	if options.HTTPClient != nil {
		return options.HTTPClient
	}
	t := options.Timeout
	if t <= 0 {
		t = 10 * time.Second
	}
	return &http.Client{Timeout: t}
}

func decodeDDG(raw string) string {
	raw = strings.ReplaceAll(raw, "&amp;", "&")
	parsed, err := url.Parse(raw)
	if err == nil {
		if uddg := parsed.Query().Get("uddg"); uddg != "" {
			return uddg
		}
	}
	return raw
}

func cleanHTML(value string) string {
	value = regexp.MustCompile(`(?s)<[^>]+>`).ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(value), " ")
}

func timeout(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

func normalizeErr(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	if strings.Contains(s, "deadline") || strings.Contains(s, "timeout") {
		return "timeout"
	}
	return s
}

func itoa(n int) string {
	if n <= 0 {
		return "5"
	}
	b := []byte{}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
