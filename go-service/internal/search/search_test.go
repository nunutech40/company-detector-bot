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

	result := DuckDuckGo(context.Background(), `"komerce.id"`, Options{Endpoint: "https://search.test/html/", HTTPClient: client, Limit: 3})
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

	result := DuckDuckGo(context.Background(), "anything", Options{Endpoint: "https://search.test/html/", HTTPClient: client})
	if result.OK || result.Error == "" {
		t.Fatalf("expected HTTP error, got ok=%v error=%q", result.OK, result.Error)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
