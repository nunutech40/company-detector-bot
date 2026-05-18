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
		Classification:    model.ClassificationUnknown, ConfidenceLabel: "low", ConfidenceScore: 15,
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
