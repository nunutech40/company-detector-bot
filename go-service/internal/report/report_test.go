package report

import (
	"strings"
	"testing"

	"company-detector/go-service/internal/model"
)

func TestReportMasksPhone(t *testing.T) {
	result := model.CompanyCheckResult{
		Input:             model.RegisterInput{Email: "person@gmail.com", FullName: "Person Name", BrandName: "Acme Studio", PhoneMasked: "*******6789"},
		EmailIntelligence: model.EmailIntelligence{OK: true, Domain: "gmail.com", IsFreeEmail: true},
		Classification:    model.ClassificationUnknown, ConfidenceLabel: "low", ConfidenceScore: 15, AutomationAction: model.ActionContinue,
		Summary: "Evidence belum cukup.", Recommendation: "Retry later.",
	}
	text := Render(result)
	if strings.Contains(text, "08123456789") {
		t.Fatalf("report leaked raw phone: %s", text)
	}
	if !strings.Contains(text, "*******6789") {
		t.Fatalf("report did not include masked phone: %s", text)
	}
}

func TestReportFallbackModeHeader(t *testing.T) {
	result := model.CompanyCheckResult{
		Input: model.RegisterInput{Email: "contact@komerce.id", BrandName: "Komerce"},
		EmailIntelligence: model.EmailIntelligence{
			OK:          true,
			Email:       "contact@komerce.id",
			Local:       "contact",
			Domain:      "komerce.id",
			IsRoleEmail: true,
		},
		DomainChecker: &model.DomainCheck{
			OK:            true,
			Domain:        "komerce.id",
			MXStatus:      "present",
			WebsiteActive: true,
			Website:       &model.WebsiteProbe{Title: "Komerce"},
		},
		WebsiteCrawler:   &model.WebsiteCrawler{OK: true, ActivePageCount: 3, SignalPageCount: 2},
		DDGSearch:        &model.SearchResponse{OK: true, Results: []model.SearchResult{{Title: "Komerce", URL: "https://komerce.id"}}},
		Classification:   model.ClassificationPossibleCompany,
		CompanyDetected:  true,
		ConfidenceLabel:  "high",
		ConfidenceScore:  92,
		AutomationAction: model.ActionRouteCompany,
		ToolsUsed:        []string{"email_intelligence", "domain_checker", "website_crawler"},
		ToolsSkipped:     []model.ToolSkipped{{Tool: "firecrawl", Reason: "disabled_waiting_budget"}},
		ToolErrors:       []model.ToolError{},
		Evidence: []model.EvidenceItem{
			{Claim: "Email uses a custom domain, not a known free provider.", Value: "komerce.id"},
			{Claim: "Email local part is a role/contact mailbox.", Value: "contact"},
			{Claim: "Website pages contain business/company signals.", Value: 2},
		},
		Recommendation: "Kirim alert ke Slack.",
	}

	text := Render(result)

	// Must start with the report header and fallback mode marker
	if !strings.HasPrefix(text, "Company Detection Report\n[FALLBACK MODE — AI reasoning tidak aktif]") {
		t.Fatalf("report does not start with fallback mode header:\n%s", text)
	}

	// Must contain conclusion section
	if !strings.Contains(text, "Kesimpulan:") {
		t.Fatalf("report missing Kesimpulan section:\n%s", text)
	}
	if !strings.Contains(text, "Akun ini kemungkinan adalah akun yang terafiliasi dengan perusahaan.") {
		t.Fatalf("report missing company conclusion:\n%s", text)
	}

	// Must contain fallback summary with tools
	for _, want := range []string{
		"[Fallback Mode] AI reasoning tidak aktif",
		"Tools dijalankan:",
		"email_intelligence",
		"domain_checker",
		"website_crawler",
		"Tools dilewati:",
		"firecrawl",
		"Evidence terkumpul:",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("report missing %q:\n%s", want, text)
		}
	}

	// Must contain scoring summary
	for _, want := range []string{
		"[Deterministik] Scoring Engine",
		"Base score : 35",
		"Final score:",
		"Artinya    : classification",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("report missing %q:\n%s", want, text)
		}
	}

	// Must NOT contain old investigation step markers
	for _, notWant := range []string{
		"[1] Email Intelligence  [Deterministik]",
		"[2] Routing Decision",
		"[3] Domain Checker",
		"[AI Reasoning]",
		"belum aktif di fase ini",
		"Proses investigasi:",
	} {
		if strings.Contains(text, notWant) {
			t.Fatalf("report should not contain old step format %q:\n%s", notWant, text)
		}
	}
}

func TestReportToolErrors(t *testing.T) {
	result := model.CompanyCheckResult{
		Input:             model.RegisterInput{Email: "contact@example.com"},
		EmailIntelligence: model.EmailIntelligence{OK: true, Domain: "example.com", IsFreeEmail: false},
		Classification:    model.ClassificationUnknown,
		ConfidenceLabel:   "low",
		ConfidenceScore:   35,
		AutomationAction:  model.ActionStoreUnknown,
		ToolsUsed:         []string{"email_intelligence"},
		ToolsSkipped:      []model.ToolSkipped{},
		ToolErrors: []model.ToolError{
			{Tool: "domain_checker", Error: "no such host"},
			{Tool: "website_crawler", Error: "context deadline exceeded"},
		},
		Evidence:       []model.EvidenceItem{},
		Recommendation: "Simpan dan retry.",
	}

	text := Render(result)

	if !strings.Contains(text, "Tools gagal:") {
		t.Fatalf("report missing Tools gagal section:\n%s", text)
	}
	if !strings.Contains(text, "domain_checker") {
		t.Fatalf("report missing domain_checker error:\n%s", text)
	}
	// simplifyError should translate "no such host"
	if !strings.Contains(text, "host tidak bisa di-resolve") {
		t.Fatalf("report missing simplified error message:\n%s", text)
	}
	// simplifyError should translate "context deadline exceeded"
	if !strings.Contains(text, "request timeout") {
		t.Fatalf("report missing timeout error message:\n%s", text)
	}
}
