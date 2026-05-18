package domaincheck

import (
	"context"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"company-detector/go-service/internal/model"
)

var domainRegex = regexp.MustCompile(`^[a-z0-9.-]+\.[a-z]{2,}$`)

type Options struct {
	HTTPClient *http.Client
	Timeout    time.Duration
}

func Check(ctx context.Context, domainInput string, options Options) model.DomainCheck {
	domain := strings.ToLower(strings.TrimSpace(domainInput))
	if !domainRegex.MatchString(domain) {
		return model.DomainCheck{
			OK: false, Domain: domainInput, Error: "invalid_domain",
			Evidence: []model.EvidenceItem{{
				SourceType: "domain_validation", Reliability: "high",
				Claim: "Domain format is invalid.", Value: domainInput, ConfidenceDelta: -20,
			}},
		}
	}

	mxs, _ := net.LookupMX(domain)
	aRecords, _ := net.LookupHost(domain)
	txtRecords, _ := net.LookupTXT(domain)

	https := fetchWebsite(ctx, "https://"+domain, options)
	var httpProbe model.WebsiteProbe
	if !https.Active {
		httpProbe = fetchWebsite(ctx, "http://"+domain, options)
	}
	best := https
	if !https.Active && httpProbe.Active {
		best = httpProbe
	} else if !https.OK && httpProbe.OK {
		best = httpProbe
	}

	mxRecords := []string{}
	for _, mx := range mxs {
		mxRecords = append(mxRecords, mx.Host)
	}
	hasMx := len(mxRecords) > 0
	hasAddress := len(aRecords) > 0
	websiteActive := best.Active

	evidence := []model.EvidenceItem{}
	if hasMx {
		evidence = append(evidence, model.EvidenceItem{SourceType: "dns_mx", Reliability: "high", Claim: "Domain has MX records and can receive email.", Value: firstN(mxRecords, 5), ConfidenceDelta: 10})
	}
	if hasAddress {
		evidence = append(evidence, model.EvidenceItem{SourceType: "dns_address", Reliability: "medium", Claim: "Domain resolves to web/server address records.", Value: firstN(aRecords, 5), ConfidenceDelta: 5})
	}
	if websiteActive {
		value := best.Title
		if value == "" {
			value = best.FinalURL
		}
		claim := "Domain website is active."
		delta := 15
		if best.Title != "" {
			claim = "Domain website is active and has a readable title."
			delta = 20
		}
		evidence = append(evidence, model.EvidenceItem{SourceType: "company_website", SourceURL: best.FinalURL, Reliability: "medium", Claim: claim, Value: value, ConfidenceDelta: delta})
	} else {
		value := best.Error
		if value == "" && best.Status != 0 {
			value = http.StatusText(best.Status)
		}
		evidence = append(evidence, model.EvidenceItem{SourceType: "company_website", SourceURL: best.URL, Reliability: "medium", Claim: "Domain website did not return an active page during MVP check.", Value: value, ConfidenceDelta: -20})
	}

	return model.DomainCheck{
		OK: true, Domain: domain, MXStatus: status(hasMx), MXRecords: firstN(mxRecords, 10),
		HasAddressRecords: hasAddress, ARecords: firstN(aRecords, 10), AAAARecords: []string{},
		TXTRecordCount: len(txtRecords), WebsiteActive: websiteActive, Website: &best, Evidence: evidence,
	}
}

func fetchWebsite(ctx context.Context, url string, options Options) model.WebsiteProbe {
	started := time.Now()
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout(options.Timeout, 8*time.Second)}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return model.WebsiteProbe{OK: false, URL: url, Active: false, Error: err.Error(), LatencyMS: elapsed(started)}
	}
	req.Header.Set("user-agent", "CompanyDetectionBot/0.1 (+https://example.internal/company-detection)")
	req.Header.Set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return model.WebsiteProbe{OK: false, URL: url, Active: false, Error: normalizeErr(err), LatencyMS: elapsed(started)}
	}
	defer resp.Body.Close()
	contentType := resp.Header.Get("content-type")
	bodySample := ""
	title := ""
	if strings.Contains(contentType, "text/html") || strings.Contains(contentType, "text/plain") {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
		body := compact(string(data))
		bodySample = truncate(body, 500)
		title = cleanTitle(string(data))
	}
	return model.WebsiteProbe{OK: true, URL: url, FinalURL: resp.Request.URL.String(), Status: resp.StatusCode, Active: resp.StatusCode >= 200 && resp.StatusCode < 400, ContentType: contentType, Title: title, BodySample: bodySample, LatencyMS: elapsed(started)}
}

func cleanTitle(html string) string {
	match := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`).FindStringSubmatch(html)
	if len(match) < 2 {
		return ""
	}
	return truncate(compact(match[1]), 180)
}

func compact(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func status(ok bool) string {
	if ok {
		return "present"
	}
	return "not_found"
}

func firstN(items []string, n int) []string {
	if len(items) <= n {
		return items
	}
	return items[:n]
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
