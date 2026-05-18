package scraper

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"company-detector/go-service/internal/model"
)

type Options struct {
	HTTPClient *http.Client
	Timeout    time.Duration
	Limit      int
}

func Scrape(ctx context.Context, targetURL string, options Options) model.ScrapeResponse {
	started := time.Now()
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout(options.Timeout, 8*time.Second)}
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	req.Header.Set("user-agent", "CompanyDetectionBot/0.1 (+https://example.internal/company-detection)")
	resp, err := client.Do(req)
	if err != nil {
		return model.ScrapeResponse{OK: false, URL: targetURL, Error: normalizeErr(err), LatencyMS: elapsed(started)}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return model.ScrapeResponse{OK: false, URL: targetURL, FinalURL: resp.Request.URL.String(), Error: resp.Status, LatencyMS: elapsed(started)}
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	limit := options.Limit
	if limit <= 0 {
		limit = 2500
	}
	return model.ScrapeResponse{OK: true, URL: targetURL, FinalURL: resp.Request.URL.String(), ContentSnippet: truncate(cleanText(string(data)), limit), LatencyMS: elapsed(started)}
}

func cleanText(value string) string {
	value = regexp.MustCompile(`(?is)<script.*?</script>`).ReplaceAllString(value, " ")
	value = regexp.MustCompile(`(?is)<style.*?</style>`).ReplaceAllString(value, " ")
	value = regexp.MustCompile(`(?s)<[^>]+>`).ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(value), " ")
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
