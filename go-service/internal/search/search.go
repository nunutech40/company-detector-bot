package search

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"company-detector/go-service/internal/model"
)

type Options struct {
	HTTPClient *http.Client
	Endpoint   string
	Limit      int
	Timeout    time.Duration
}

func DuckDuckGo(ctx context.Context, query string, options Options) model.SearchResponse {
	endpoint := options.Endpoint
	if endpoint == "" {
		endpoint = "https://duckduckgo.com/html/"
	}
	limit := options.Limit
	if limit <= 0 {
		limit = 5
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout(options.Timeout, 8*time.Second)}
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?q="+url.QueryEscape(query), nil)
	req.Header.Set("user-agent", "CompanyDetectionBot/0.1 (+https://example.internal/company-detection)")
	resp, err := client.Do(req)
	if err != nil {
		return model.SearchResponse{OK: false, Error: normalizeErr(err), Query: query}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return model.SearchResponse{OK: false, Error: resp.Status, Query: query}
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	return model.SearchResponse{OK: true, Query: query, Results: parseResults(string(data), limit)}
}

func parseResults(html string, limit int) []model.SearchResult {
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
	if strings.Contains(err.Error(), "deadline") || strings.Contains(err.Error(), "timeout") {
		return "timeout"
	}
	return err.Error()
}
