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

func TestReportUsesConclusionFirstAndHumanFlow(t *testing.T) {
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
		SerpQueries:      &model.QueryPlan{OK: true, Queries: []string{"komerce.id", "Komerce"}},
		DDGSearch:        &model.SearchResponse{OK: true, Results: []model.SearchResult{{Title: "Komerce", URL: "https://komerce.id"}}},
		Classification:   model.ClassificationPossibleCompany,
		CompanyDetected:  true,
		ConfidenceLabel:  "high",
		ConfidenceScore:  92,
		AutomationAction: model.ActionRouteCompany,
		Evidence: []model.EvidenceItem{
			{Claim: "Email uses a custom domain, not a known free provider.", Value: "komerce.id"},
			{Claim: "Email local part is a role/contact mailbox.", Value: "contact"},
			{Claim: "Website pages contain business/company signals.", Value: 2},
		},
		Recommendation: "Kirim alert ke Slack.",
	}

	text := Render(result)
	if !strings.HasPrefix(text, "Company Detection Report\n\nKesimpulan:\nAkun ini kemungkinan adalah akun yang terafiliasi dengan perusahaan.") {
		t.Fatalf("report does not start with conclusion-first format:\n%s", text)
	}
	for _, want := range []string{
		"Data yang berhasil dikumpulkan:",
		"Alur pengecekan:",
		"Email intelligence mengecek",
		"Domain checker mengecek",
		"Scoring engine menggabungkan",
		"Domain email adalah custom domain, bukan provider email gratis",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("report missing %q:\n%s", want, text)
		}
	}
}
