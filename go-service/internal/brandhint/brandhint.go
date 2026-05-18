// Package brandhint detects whether an email local part looks like a brand/store name
// rather than a person's name. This helps the AI reasoning loop decide whether to
// search for a business (e.g. "nawaystore tokopedia") vs a person (e.g. "Tatak Subekti LinkedIn").
package brandhint

import "strings"

// Result holds the brand hint analysis for an email local part.
type Result struct {
	Local       string   // original local part
	IsBrandHint bool     // true if local part looks like a brand/store
	Confidence  string   // "high", "medium", "low"
	Signals     []string // which keywords triggered the detection
	Suggestion  string   // suggested search strategy
}

// brandKeywords are patterns commonly found in Indonesian/general brand/store names.
// Ordered by specificity — more specific patterns first.
var brandKeywords = []struct {
	keyword    string
	confidence string
}{
	// Strong brand signals (high confidence)
	{"store", "high"}, {"shop", "high"}, {"toko", "high"}, {"mart", "high"},
	{"market", "high"}, {"official", "high"}, {"inc", "high"}, {"corp", "high"},
	{"studio", "high"}, {"agency", "high"}, {"brand", "high"},

	// Medium brand signals
	{"design", "medium"}, {"creative", "medium"}, {"digital", "medium"},
	{"tech", "medium"}, {"media", "medium"}, {"fashion", "medium"},
	{"beauty", "medium"}, {"food", "medium"}, {"cafe", "medium"},
	{"kitchen", "medium"}, {"collection", "medium"}, {"boutique", "medium"},
	{"craft", "medium"}, {"art", "medium"}, {"wear", "medium"},
	{"style", "medium"}, {"id", "medium"}, {"co", "medium"},
	{"naway", "medium"}, // specific known brand pattern

	// Weak brand signals (could be person or brand)
	{"shop", "low"}, {"online", "low"}, {"indo", "low"}, {"jaya", "low"},
	{"maju", "low"}, {"makmur", "low"}, {"sejahtera", "low"},
}

// personPatterns are patterns that suggest a person's name rather than a brand.
// If these match, brand hint confidence is reduced.
var personPatterns = []string{
	// Indonesian name patterns: initial.lastname, firstname.lastname
	".", "_",
}

// Analyze checks if the email local part looks like a brand/store name.
// Input: email local part (e.g. "nawaystore", "r.fajarnugraha", "uitdiedos")
func Analyze(local string) Result {
	lower := strings.ToLower(strings.TrimSpace(local))

	// Check for person name patterns first
	hasPersonPattern := false
	for _, p := range personPatterns {
		if strings.Contains(lower, p) {
			hasPersonPattern = true
			break
		}
	}

	// Find matching brand keywords
	signals := []string{}
	highestConfidence := ""
	for _, kw := range brandKeywords {
		if strings.Contains(lower, kw.keyword) {
			signals = append(signals, kw.keyword)
			if highestConfidence == "" {
				highestConfidence = kw.confidence
			} else if kw.confidence == "high" {
				highestConfidence = "high"
			} else if kw.confidence == "medium" && highestConfidence == "low" {
				highestConfidence = "medium"
			}
		}
	}

	isBrand := len(signals) > 0 && !hasPersonPattern
	confidence := highestConfidence
	if !isBrand {
		confidence = "low"
	}
	// Person pattern reduces confidence
	if hasPersonPattern && len(signals) > 0 {
		isBrand = false
		confidence = "low"
	}

	suggestion := ""
	if isBrand {
		suggestion = "search as brand/store: \"" + local + "\" tokopedia OR shopee OR instagram OR website"
	} else {
		suggestion = "search as person name or username"
	}

	return Result{
		Local:       local,
		IsBrandHint: isBrand,
		Confidence:  confidence,
		Signals:     signals,
		Suggestion:  suggestion,
	}
}
