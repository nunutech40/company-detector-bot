package scoring

import (
	"strings"

	"company-detector/go-service/internal/model"
)

// Score calculates classification and confidence from evidence.
// Evidence items from AI (source_type starting with "ai_") are only counted
// if they have a source_url or tool_call — this prevents hallucinated claims
// from affecting the score.
func Score(evidence []model.EvidenceItem, email model.EmailIntelligence, domain *model.DomainCheck, input model.RegisterInput) model.ScoreResult {
	base := 35
	delta := 0
	rejected := 0
	for _, item := range evidence {
		if isAIEvidence(item) && !hasVerifiableSource(item) {
			// AI-sourced evidence without a verifiable source is rejected
			rejected++
			continue
		}
		delta += item.ConfidenceDelta
	}
	final := clamp(base + delta)
	classification := classify(email, domain, final, input)
	action := actionFor(classification)
	return model.ScoreResult{
		OK: true, Classification: classification, CompanyDetected: classification == model.ClassificationPossibleCompany,
		ConfidenceScore: final, ConfidenceLabel: label(final), AutomationAction: action,
		OwnerClaimAllowed: false,
		ScoreBreakdown:    model.ScoreBreakdown{BaseScore: base, EvidenceDelta: delta, FinalScore: final, RejectedEvidence: rejected},
	}
}

// isAIEvidence returns true for evidence items that came from AI reasoning
// rather than deterministic Go tools. These require extra verification.
func isAIEvidence(item model.EvidenceItem) bool {
	aiPrefixes := []string{"ai_", "ai_reasoning", "ai_claim"}
	for _, prefix := range aiPrefixes {
		if strings.HasPrefix(item.SourceType, prefix) {
			return true
		}
	}
	return false
}

// hasVerifiableSource returns true if the evidence has a source URL or tool call
// that can be audited. This is the enforcement mechanism against hallucination.
func hasVerifiableSource(item model.EvidenceItem) bool {
	return strings.TrimSpace(item.SourceURL) != "" || strings.TrimSpace(item.ToolCall) != ""
}

// PhoneConfirmationEvidence creates a high-confidence evidence item when
// a phone number found in tool results matches the registered no_hp.
// This should be called by the AI orchestrator when a match is found.
// Delta: +25 (strong confirmation — same person/business)
func PhoneConfirmationEvidence(sourceURL string, foundIn string) model.EvidenceItem {
	return model.EvidenceItem{
		SourceType:      "phone_confirmation",
		SourceURL:       sourceURL,
		ToolCall:        "phone_match(" + foundIn + ")",
		Reliability:     "high",
		Claim:           "Phone number from registration matches number found in " + foundIn + ".",
		ConfidenceDelta: 25,
		Verified:        true,
	}
}

func classify(email model.EmailIntelligence, domain *model.DomainCheck, score int, input model.RegisterInput) model.Classification {
	if !email.OK || email.IsDisposable {
		return model.ClassificationSuspicious
	}
	if email.IsFreeEmail {
		if input.BrandName != "" || score >= 45 {
			return model.ClassificationUnknown
		}
		return model.ClassificationPersonal
	}
	if domain != nil && domain.WebsiteActive {
		return model.ClassificationPossibleCompany
	}
	if score >= 45 {
		return model.ClassificationPossibleCompany
	}
	return model.ClassificationUnknown
}

func actionFor(classification model.Classification) model.AutomationAction {
	switch classification {
	case model.ClassificationPossibleCompany:
		return model.ActionRouteCompany
	case model.ClassificationPersonal:
		return model.ActionContinue
	case model.ClassificationSuspicious:
		return model.ActionRiskReview
	default:
		return model.ActionStoreUnknown
	}
}

func label(score int) string {
	if score >= 75 {
		return "high"
	}
	if score >= 45 {
		return "medium"
	}
	return "low"
}

func clamp(score int) int {
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}
