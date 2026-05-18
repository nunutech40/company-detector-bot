package scoring

import (
	"testing"

	"company-detector/go-service/internal/model"
)

func TestFreeEmailWithBrandRemainsUnknown(t *testing.T) {
	email := model.EmailIntelligence{OK: true, IsFreeEmail: true}
	input := model.RegisterInput{Email: "person@gmail.com", BrandName: "Acme Studio"}
	got := Score([]model.EvidenceItem{{ConfidenceDelta: -30}, {ConfidenceDelta: 10}}, email, nil, input)
	if got.Classification != model.ClassificationUnknown {
		t.Fatalf("expected unknown, got %#v", got)
	}
}

func TestCustomDomainCompany(t *testing.T) {
	email := model.EmailIntelligence{OK: true}
	got := Score([]model.EvidenceItem{{ConfidenceDelta: 30}}, email, nil, model.RegisterInput{})
	if got.Classification != model.ClassificationPossibleCompany {
		t.Fatalf("expected company, got %#v", got)
	}
}
