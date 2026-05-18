package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"
)

type Options struct {
	HTTPClient *http.Client
	Endpoint   string
	Token      string
	Channel    string
	Timeout    time.Duration
}

type Response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func Send(ctx context.Context, text string, options Options) Response {
	token := options.Token
	if token == "" {
		token = os.Getenv("SLACK_BOT_TOKEN")
	}
	channel := options.Channel
	if channel == "" {
		channel = os.Getenv("SLACK_REPORT_CHANNEL")
	}
	if token == "" || channel == "" {
		return Response{OK: false, Error: "missing_slack_config"}
	}
	endpoint := options.Endpoint
	if endpoint == "" {
		endpoint = "https://slack.com/api/chat.postMessage"
	}
	body, _ := json.Marshal(map[string]string{"channel": channel, "text": text})
	client := options.HTTPClient
	if client == nil {
		timeout := options.Timeout
		if timeout <= 0 {
			timeout = 8 * time.Second
		}
		client = &http.Client{Timeout: timeout}
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	defer resp.Body.Close()
	var parsed Response
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	return parsed
}
