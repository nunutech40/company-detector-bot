package orchestrator

import (
	"context"
	"strings"
	"time"

	"company-detector/go-service/internal/crawler"
	"company-detector/go-service/internal/domaincheck"
	"company-detector/go-service/internal/emailintel"
	"company-detector/go-service/internal/model"
	"company-detector/go-service/internal/query"
	"company-detector/go-service/internal/report"
	"company-detector/go-service/internal/scoring"
	"company-detector/go-service/internal/scraper"
	"company-detector/go-service/internal/search"
)

type Options struct {
	Clock             func() time.Time
	DomainCheck       func(context.Context, string) model.DomainCheck
	Crawl             func(context.Context, string) model.WebsiteCrawler
	Search            func(context.Context, string) model.SearchResponse
	Scrape            func(context.Context, string) model.ScrapeResponse
	SkipNetwork       bool
	SearchResultLimit int
}

func Run(ctx context.Context, input model.RegisterInput, options Options) model.CompanyCheckResult {
	now := time.Now
	if options.Clock != nil {
		now = options.Clock
	}

	email := emailintel.Analyze(input.Email)
	evidence := []model.EvidenceItem{}
	evidence = append(evidence, email.Evidence...)
	evidence = append(evidence, inputEvidence(input)...)

	result := model.CompanyCheckResult{
		OK:                email.OK,
		JobType:           "company_detection_mvp",
		ObservedAt:        now().UTC().Format(time.RFC3339),
		Input:             input,
		EmailIntelligence: email,
		ToolsUsed:         []string{"email_intelligence"},
		ToolsSkipped:      []model.ToolSkipped{},
		ToolErrors:        []model.ToolError{},
		Evidence:          evidence,
	}

	if !email.OK {
		score := scoring.Score(result.Evidence, email, nil, input)
		applyScore(&result, score)
		result.ToolsSkipped = append(result.ToolsSkipped,
			model.ToolSkipped{Tool: "domain_checker", Reason: "invalid_email"},
			model.ToolSkipped{Tool: "website_crawler", Reason: "invalid_email"},
			model.ToolSkipped{Tool: "ddg_search", Reason: "invalid_email"},
			model.ToolSkipped{Tool: "free_scraper", Reason: "invalid_email"},
		)
		result.Summary = "Input email tidak valid, jadi sistem tidak bisa membuat dugaan perusahaan yang layak."
		result.Recommendation = "Risk/format review. Jangan route ke Slack sebagai company alert."
		result.TelegramReport = report.Render(result)
		return result
	}

	result.SerpQueries = queryPtr(query.Build(query.Input{
		Email:                input.Email,
		Domain:               email.Domain,
		Local:                email.Local,
		FullName:             input.FullName,
		BrandName:            input.BrandName,
		IncludeDomainQueries: !email.IsFreeEmail,
	}))

	var domain *model.DomainCheck
	var crawl *model.WebsiteCrawler
	if email.IsFreeEmail {
		result.ToolsSkipped = append(result.ToolsSkipped,
			model.ToolSkipped{Tool: "domain_checker", Reason: "free_email_provider"},
			model.ToolSkipped{Tool: "website_crawler", Reason: "free_email_provider"},
		)
	} else if options.SkipNetwork {
		result.ToolsSkipped = append(result.ToolsSkipped,
			model.ToolSkipped{Tool: "domain_checker", Reason: "network_disabled"},
			model.ToolSkipped{Tool: "website_crawler", Reason: "network_disabled"},
		)
	} else {
		domainCheck := runDomainCheck(ctx, email.Domain, options)
		domain = &domainCheck
		result.DomainChecker = domain
		result.Evidence = append(result.Evidence, domainCheck.Evidence...)
		if domainCheck.OK {
			result.ToolsUsed = append(result.ToolsUsed, "domain_checker")
		} else {
			result.ToolErrors = append(result.ToolErrors, model.ToolError{Tool: "domain_checker", Error: domainCheck.Error})
		}

		crawlResult := runCrawl(ctx, email.Domain, options)
		crawl = &crawlResult
		result.WebsiteCrawler = crawl
		result.Evidence = append(result.Evidence, crawlResult.Evidence...)
		if crawlResult.OK {
			result.ToolsUsed = append(result.ToolsUsed, "website_crawler")
		} else {
			result.ToolErrors = append(result.ToolErrors, model.ToolError{Tool: "website_crawler", Error: crawlResult.Error})
		}
	}

	primaryQuery := choosePrimaryQuery(*result.SerpQueries, email)
	if primaryQuery == "" {
		result.ToolsSkipped = append(result.ToolsSkipped, model.ToolSkipped{Tool: "ddg_search", Reason: "no_search_query_available"})
	} else if options.SkipNetwork {
		result.ToolsSkipped = append(result.ToolsSkipped, model.ToolSkipped{Tool: "ddg_search", Reason: "network_disabled"})
	} else {
		searchResult := runSearch(ctx, primaryQuery, options)
		result.DDGSearch = &searchResult
		if searchResult.OK {
			result.ToolsUsed = append(result.ToolsUsed, "ddg_search")
			result.Evidence = append(result.Evidence, searchEvidence(searchResult)...)
		} else {
			result.ToolErrors = append(result.ToolErrors, model.ToolError{Tool: "ddg_search", Error: searchResult.Error})
		}
	}

	scrapeURL := pickScrapeURL(domain, crawl)
	if scrapeURL == "" {
		result.ToolsSkipped = append(result.ToolsSkipped, model.ToolSkipped{Tool: "free_scraper", Reason: "no_active_url_to_scrape"})
	} else if options.SkipNetwork {
		result.ToolsSkipped = append(result.ToolsSkipped, model.ToolSkipped{Tool: "free_scraper", Reason: "network_disabled"})
	} else {
		scrapeResult := runScrape(ctx, scrapeURL, options)
		result.FreeScraper = &scrapeResult
		if scrapeResult.OK {
			result.ToolsUsed = append(result.ToolsUsed, "free_scraper")
			result.Evidence = append(result.Evidence, scrapeEvidence(scrapeResult)...)
		} else {
			result.ToolErrors = append(result.ToolErrors, model.ToolError{Tool: "free_scraper", Error: scrapeResult.Error})
		}
	}

	result.ToolsSkipped = append(result.ToolsSkipped,
		model.ToolSkipped{Tool: "firecrawl", Reason: "disabled_waiting_budget"},
		model.ToolSkipped{Tool: "tavily_or_serpapi", Reason: "disabled_waiting_budget"},
		model.ToolSkipped{Tool: "paid_enrichment", Reason: "disabled_waiting_budget"},
		model.ToolSkipped{Tool: "browser_agent", Reason: "not_enabled_in_go_port"},
	)

	score := scoring.Score(result.Evidence, email, domain, input)
	applyScore(&result, score)
	result.Summary = summary(result)
	result.Recommendation = recommendation(result)
	result.TelegramReport = report.Render(result)
	return result
}

func inputEvidence(input model.RegisterInput) []model.EvidenceItem {
	out := []model.EvidenceItem{}
	if input.FullName != "" {
		out = append(out, model.EvidenceItem{SourceType: "registration_input", Reliability: "medium", Claim: "Signup provided a full name.", Value: input.FullName, ConfidenceDelta: 0})
	}
	if input.BrandName != "" {
		out = append(out, model.EvidenceItem{SourceType: "registration_input", Reliability: "medium", Claim: "Signup provided a brand/company field.", Value: input.BrandName, ConfidenceDelta: 10})
	}
	if input.PhoneMasked != "" {
		out = append(out, model.EvidenceItem{SourceType: "registration_input", Reliability: "low", Claim: "Signup provided a phone number for internal correlation only.", Value: input.PhoneMasked, ConfidenceDelta: 0})
	}
	return out
}

func runDomainCheck(ctx context.Context, domain string, options Options) model.DomainCheck {
	if options.DomainCheck != nil {
		return options.DomainCheck(ctx, domain)
	}
	return domaincheck.Check(ctx, domain, domaincheck.Options{})
}

func runCrawl(ctx context.Context, domain string, options Options) model.WebsiteCrawler {
	if options.Crawl != nil {
		return options.Crawl(ctx, domain)
	}
	return crawler.Crawl(ctx, domain, crawler.Options{})
}

func runSearch(ctx context.Context, q string, options Options) model.SearchResponse {
	if options.Search != nil {
		return options.Search(ctx, q)
	}
	limit := options.SearchResultLimit
	if limit <= 0 {
		limit = 5
	}
	return search.DuckDuckGo(ctx, q, search.Options{Limit: limit})
}

func runScrape(ctx context.Context, targetURL string, options Options) model.ScrapeResponse {
	if options.Scrape != nil {
		return options.Scrape(ctx, targetURL)
	}
	return scraper.Scrape(ctx, targetURL, scraper.Options{})
}

func choosePrimaryQuery(plan model.QueryPlan, email model.EmailIntelligence) string {
	if len(plan.Queries) == 0 {
		return ""
	}
	if !email.IsFreeEmail {
		return plan.Queries[0]
	}
	for _, q := range plan.Queries {
		if strings.Contains(q, "company") || strings.Contains(q, "LinkedIn") {
			return q
		}
	}
	return plan.Queries[0]
}

func pickScrapeURL(domain *model.DomainCheck, crawl *model.WebsiteCrawler) string {
	if domain != nil && domain.Website != nil && domain.Website.Active {
		if domain.Website.FinalURL != "" {
			return domain.Website.FinalURL
		}
		return domain.Website.URL
	}
	if crawl != nil {
		for _, page := range crawl.Pages {
			if page.Active {
				if page.FinalURL != "" {
					return page.FinalURL
				}
				return page.URL
			}
		}
	}
	return ""
}

func searchEvidence(searchResult model.SearchResponse) []model.EvidenceItem {
	if len(searchResult.Results) == 0 {
		return []model.EvidenceItem{{SourceType: "ddg_search", Reliability: "low", Claim: "Search ran but returned no parsed public results.", Value: searchResult.Query, ConfidenceDelta: 0}}
	}
	values := []string{}
	for _, item := range searchResult.Results {
		values = append(values, item.Title+" - "+item.URL)
	}
	return []model.EvidenceItem{{SourceType: "ddg_search", Reliability: "low", Claim: "Public search returned candidate company/social evidence.", Value: values, ConfidenceDelta: min(15, len(values)*5)}}
}

func scrapeEvidence(scrapeResult model.ScrapeResponse) []model.EvidenceItem {
	text := strings.ToLower(scrapeResult.ContentSnippet)
	delta := 5
	claim := "Free scraper captured readable page content."
	if strings.Contains(text, "company") || strings.Contains(text, "platform") || strings.Contains(text, "service") || strings.Contains(text, "business") {
		delta = 10
		claim = "Free scraper captured page content with business/company terms."
	}
	return []model.EvidenceItem{{SourceType: "free_scraper", SourceURL: scrapeResult.FinalURL, Reliability: "low", Claim: claim, Value: truncate(scrapeResult.ContentSnippet, 220), ConfidenceDelta: delta}}
}

func applyScore(result *model.CompanyCheckResult, score model.ScoreResult) {
	result.Classification = score.Classification
	result.CompanyDetected = score.CompanyDetected
	result.ConfidenceScore = score.ConfidenceScore
	result.ConfidenceLabel = score.ConfidenceLabel
	result.AutomationAction = score.AutomationAction
	result.OwnerClaimAllowed = score.OwnerClaimAllowed
	result.Scoring = score.ScoreBreakdown
}

func summary(result model.CompanyCheckResult) string {
	switch result.Classification {
	case model.ClassificationPossibleCompany:
		if result.EmailIntelligence.IsFreeEmail {
			return "Email memakai free provider, tapi ada sinyal brand/bisnis yang cukup untuk dianggap terkait perusahaan."
		}
		return "Email memakai custom domain dan sinyal domain/bisnis cukup kuat untuk dianggap terkait perusahaan."
	case model.ClassificationPersonal:
		return "Email terlihat personal dan belum punya sinyal bisnis yang cukup."
	case model.ClassificationSuspicious:
		return "Email/input terlihat invalid atau berisiko, sehingga perlu review format/risk."
	default:
		return "Sinyal belum cukup kuat. Data disimpan untuk enrichment berikutnya, tapi belum layak dianggap company alert."
	}
}

func recommendation(result model.CompanyCheckResult) string {
	switch result.AutomationAction {
	case model.ActionRouteCompany:
		return "Route ke Slack/company alert dan simpan detail evidence ke database."
	case model.ActionRiskReview:
		return "Jangan route sebagai company alert. Tandai untuk review kualitas input."
	case model.ActionContinue:
		return "Lanjutkan sebagai akun personal/unknown dan tetap simpan hasil pengecekan."
	default:
		return "Simpan sebagai unknown, lalu retry enrichment saat tool pencarian/DB production aktif."
	}
}

func queryPtr(plan model.QueryPlan) *model.QueryPlan {
	return &plan
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
