package scraper

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestScrapeReturnsCleanSnippet(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html"}},
			Body:       io.NopCloser(bytes.NewBufferString(`<html><script>ignore()</script><body><h1>Acme</h1><p>Company service platform.</p></body></html>`)),
			Request:    req,
		}, nil
	})}

	result := Scrape(context.Background(), "https://example.test", Options{HTTPClient: client})
	if !result.OK {
		t.Fatalf("expected ok, got %q", result.Error)
	}
	if strings.Contains(result.ContentSnippet, "ignore") {
		t.Fatalf("script text leaked into snippet: %q", result.ContentSnippet)
	}
	if !strings.Contains(result.ContentSnippet, "Company service platform") {
		t.Fatalf("expected body text in snippet, got %q", result.ContentSnippet)
	}
}

func TestScrapeReportsHTTPError(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Status:     "404 Not Found",
			Body:       io.NopCloser(bytes.NewBufferString("not found")),
			Request:    req,
		}, nil
	})}

	result := Scrape(context.Background(), "https://example.test", Options{HTTPClient: client})
	if result.OK || result.Error == "" {
		t.Fatalf("expected HTTP error, got ok=%v error=%q", result.OK, result.Error)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
