package scoring

import "company-detector/go-service/internal/model"

func Score(evidence []model.EvidenceItem, email model.EmailIntelligence, domain *model.DomainCheck, input model.RegisterInput) model.ScoreResult {
	base := 35
	delta := 0
	for _, item := range evidence {
		delta += item.ConfidenceDelta
	}
	final := clamp(base + delta)
	classification := classify(email, domain, final, input)
	action := actionFor(classification)
	return model.ScoreResult{
		OK: true, Classification: classification, CompanyDetected: classification == model.ClassificationPossibleCompany,
		ConfidenceScore: final, ConfidenceLabel: label(final), AutomationAction: action,
		OwnerClaimAllowed: false,
		ScoreBreakdown:    model.ScoreBreakdown{BaseScore: base, EvidenceDelta: delta, FinalScore: final},
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
