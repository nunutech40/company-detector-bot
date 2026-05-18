package crawler

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"
)

func TestCrawlFindsBusinessSignals(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
			Body:       io.NopCloser(bytes.NewBufferString(`<html><head><title>Acme Commerce</title></head><body>We are a company platform with a founder team and contact support.</body></html>`)),
			Request:    req,
		}, nil
	})}

	result := Crawl(context.Background(), "example.com", Options{BaseURL: "https://example.test", HTTPClient: client, MaxPages: 1})

	if !result.OK {
		t.Fatalf("expected crawl ok, got error %q", result.Error)
	}
	if result.ActivePageCount != 1 {
		t.Fatalf("expected one active page, got %d", result.ActivePageCount)
	}
	if result.SignalPageCount != 1 {
		t.Fatalf("expected one signal page, got %d", result.SignalPageCount)
	}
	if len(result.Evidence) == 0 {
		t.Fatal("expected crawl evidence")
	}
}

func TestCrawlRejectsInvalidDomainWithoutBaseURL(t *testing.T) {
	result := Crawl(context.Background(), "bad domain", Options{})
	if result.OK || result.Error != "invalid_domain" {
		t.Fatalf("expected invalid_domain, got ok=%v error=%q", result.OK, result.Error)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
