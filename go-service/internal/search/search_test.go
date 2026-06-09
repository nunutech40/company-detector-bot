package search

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"
)

func TestDuckDuckGoParsesResults(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Query().Get("q") != `"komerce.id"` {
			t.Fatalf("unexpected query %q", req.URL.Query().Get("q"))
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html"}},
			Body:       io.NopCloser(bytes.NewBufferString(`<a class="result__a" href="/l/?uddg=https%3A%2F%2Fkomerce.id%2F">Komerce Official</a>`)),
			Request:    req,
		}, nil
	})}

	result := DuckDuckGo(context.Background(), `"komerce.id"`, Options{DDGEndpoint: "https://search.test/html/", HTTPClient: client, Limit: 3})
	if !result.OK {
		t.Fatalf("expected ok, got %q", result.Error)
	}
	if len(result.Results) != 1 {
		t.Fatalf("expected one result, got %d", len(result.Results))
	}
	if result.Results[0].URL != "https://komerce.id/" {
		t.Fatalf("unexpected decoded URL %q", result.Results[0].URL)
	}
}

func TestDuckDuckGoReportsHTTPError(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Status:     "429 Too Many Requests",
			Body:       io.NopCloser(bytes.NewBufferString("nope")),
			Request:    req,
		}, nil
	})}

	result := DuckDuckGo(context.Background(), "anything", Options{DDGEndpoint: "https://search.test/html/", HTTPClient: client})
	if result.OK || result.Error == "" {
		t.Fatalf("expected HTTP error, got ok=%v error=%q", result.OK, result.Error)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestGoogleCSEParsesResults(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(bytes.NewBufferString(`{
				"items": [
					{"title": "Komerce", "link": "https://komerce.id/", "snippet": "End-to-end e-commerce enabler"}
				]
			}`)),
			Request: req,
		}, nil
	})}
	t.Setenv("GOOGLE_CSE_KEY", "test-key")
	t.Setenv("GOOGLE_CSE_ID", "test-cx")
	result := googleCSE(context.Background(), "komerce.id", Options{GoogleEndpoint: "https://cse.test/", HTTPClient: client, Limit: 3})
	if !result.OK {
		t.Fatalf("expected ok, got %q", result.Error)
	}
	if len(result.Results) != 1 || result.Results[0].URL != "https://komerce.id/" {
		t.Fatalf("unexpected results: %+v", result.Results)
	}
	if result.Results[0].Snippet == "" {
		t.Fatal("expected snippet in result")
	}
}

func TestGoogleCSESkipsWhenNotConfigured(t *testing.T) {
	t.Setenv("GOOGLE_CSE_KEY", "")
	t.Setenv("GOOGLE_CSE_ID", "")
	result := googleCSE(context.Background(), "anything", Options{})
	if result.OK || !contains(result.Error, "not_configured") {
		t.Fatalf("expected not_configured error, got ok=%v error=%q", result.OK, result.Error)
	}
}

func TestBraveSearchSkipsWhenNotConfigured(t *testing.T) {
	t.Setenv("BRAVE_SEARCH_API_KEY", "")
	result := braveSearch(context.Background(), "anything", Options{})
	if result.OK || !contains(result.Error, "not_configured") {
		t.Fatalf("expected not_configured error, got ok=%v error=%q", result.OK, result.Error)
	}
}

func TestBraveSearchDoesNotSetAcceptEncodingManually(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Accept-Encoding") != "" {
			t.Fatalf("Accept-Encoding must be managed by the Go transport")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(bytes.NewBufferString(`{
				"web": {"results": [
					{"title": "Romelaanasa", "url": "https://example.com/", "description": "Distributor NASA"}
				]}
			}`)),
			Request: req,
		}, nil
	})}
	t.Setenv("BRAVE_SEARCH_API_KEY", "test-key")
	result := braveSearch(context.Background(), "Romelaanasa", Options{BraveEndpoint: "https://brave.test/search", HTTPClient: client})
	if !result.OK || len(result.Results) != 1 {
		t.Fatalf("expected parsed Brave result, got %+v", result)
	}
}

func TestBingHTMLParsesResults(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html"}},
			Body: io.NopCloser(bytes.NewBufferString(`
				<li class="b_algo">
					<h2><a href="https://komerce.id/">Komerce Official</a></h2>
					<p class="b_lineclamp2">End-to-end e-commerce enabler</p>
				</li>
			`)),
			Request: req,
		}, nil
	})}
	result := bingHTML(context.Background(), "komerce.id", Options{BingEndpoint: "https://bing.test/search", HTTPClient: client, Limit: 3})
	if !result.OK {
		t.Fatalf("expected ok, got %q", result.Error)
	}
	if len(result.Results) == 0 {
		t.Fatal("expected at least one result")
	}
}

func TestProvidersReturnsStatus(t *testing.T) {
	t.Setenv("GOOGLE_CSE_KEY", "")
	t.Setenv("GOOGLE_CSE_ID", "")
	t.Setenv("BRAVE_SEARCH_API_KEY", "")
	statuses := Providers()
	if len(statuses) != 4 {
		t.Fatalf("expected 4 providers, got %d", len(statuses))
	}
	// Google and Brave should be unavailable without keys
	for _, s := range statuses {
		if s.Name == "google_cse" && s.Available {
			t.Fatal("google_cse should not be available without keys")
		}
		if s.Name == "brave_search" && s.Available {
			t.Fatal("brave_search should not be available without key")
		}
		// Bing and DDG are always available
		if (s.Name == "bing_html" || s.Name == "ddg_html") && !s.Available {
			t.Fatalf("%s should always be available", s.Name)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(substr); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
			return false
		}())
}
