package orchestrator

import (
	"context"
	"testing"
	"time"

	"company-detector/go-service/internal/model"
)

func TestRunClassifiesCustomDomainCompany(t *testing.T) {
	input := model.RegisterInput{Email: "contact@komerce.id", BrandName: "Komerce"}
	result := Run(context.Background(), input, Options{
		Clock: func() time.Time { return time.Date(2026, 5, 18, 3, 0, 0, 0, time.UTC) },
		DomainCheck: func(ctx context.Context, domain string) model.DomainCheck {
			return model.DomainCheck{
				OK: true, Domain: domain, MXStatus: "present", WebsiteActive: true,
				Website:  &model.WebsiteProbe{OK: true, URL: "https://komerce.id", FinalURL: "https://komerce.id", Active: true, Status: 200, Title: "Komerce"},
				Evidence: []model.EvidenceItem{{SourceType: "company_website", Reliability: "medium", Claim: "Domain website is active.", Value: "Komerce", ConfidenceDelta: 20}},
			}
		},
		Crawl: func(ctx context.Context, domain string) model.WebsiteCrawler {
			return model.WebsiteCrawler{OK: true, Domain: domain, ActivePageCount: 1, SignalPageCount: 1, Pages: []model.CrawlPage{{Active: true, URL: "https://komerce.id", FinalURL: "https://komerce.id"}}, Evidence: []model.EvidenceItem{{SourceType: "website_crawler", Reliability: "medium", Claim: "Business signals found.", ConfidenceDelta: 15}}}
		},
		Search: func(ctx context.Context, q string) model.SearchResponse {
			return model.SearchResponse{OK: true, Query: q, Results: []model.SearchResult{{Title: "Komerce", URL: "https://komerce.id"}}}
		},
		Scrape: func(ctx context.Context, targetURL string) model.ScrapeResponse {
			return model.ScrapeResponse{OK: true, URL: targetURL, FinalURL: targetURL, ContentSnippet: "Komerce company platform"}
		},
	})

	if result.Classification != model.ClassificationPossibleCompany {
		t.Fatalf("expected company classification, got %s", result.Classification)
	}
	if !result.CompanyDetected {
		t.Fatal("expected company detected")
	}
	if result.TelegramReport == "" {
		t.Fatal("expected rendered report")
	}
}

func TestRunFreeEmailWithBrandStaysUnknown(t *testing.T) {
	input := model.RegisterInput{Email: "owner@gmail.com", FullName: "Owner Name", BrandName: "Acme"}
	result := Run(context.Background(), input, Options{SkipNetwork: true})

	if result.Classification != model.ClassificationUnknown {
		t.Fatalf("expected unknown classification, got %s", result.Classification)
	}
	if result.DomainChecker != nil {
		t.Fatal("did not expect domain checker for free email")
	}
	if result.AutomationAction != model.ActionStoreUnknown {
		t.Fatalf("expected store unknown action, got %s", result.AutomationAction)
	}
}
