package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestSendPostsSlackMessage(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("authorization") != "Bearer xoxb-test" {
			t.Fatalf("unexpected auth header %q", req.Header.Get("authorization"))
		}
		var payload map[string]string
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload["channel"] != "C123" || payload["text"] != "hello" {
			t.Fatalf("unexpected payload %#v", payload)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(`{"ok":true}`)),
			Request:    req,
		}, nil
	})}

	response := Send(context.Background(), "hello", Options{Endpoint: "https://slack.test/api/chat.postMessage", HTTPClient: client, Token: "xoxb-test", Channel: "C123"})
	if !response.OK {
		t.Fatalf("expected ok, got %q", response.Error)
	}
}

func TestSendReturnsSlackError(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(`{"ok":false,"error":"channel_not_found"}`)),
			Request:    req,
		}, nil
	})}

	response := Send(context.Background(), "hello", Options{Endpoint: "https://slack.test/api/chat.postMessage", HTTPClient: client, Token: "xoxb-test", Channel: "C123"})
	if response.OK || response.Error != "channel_not_found" {
		t.Fatalf("expected channel_not_found, got ok=%v error=%q", response.OK, response.Error)
	}
}

func TestSendRequiresConfig(t *testing.T) {
	response := Send(context.Background(), "hello", Options{})
	if response.OK || response.Error != "missing_slack_config" {
		t.Fatalf("expected missing_slack_config, got ok=%v error=%q", response.OK, response.Error)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
