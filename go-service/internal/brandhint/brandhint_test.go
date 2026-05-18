package brandhint

import "testing"

func TestBrandHintDetection(t *testing.T) {
	cases := []struct {
		local      string
		isBrand    bool
		confidence string
	}{
		{"nawaystore", true, "high"},
		{"tokobaju", true, "high"},
		{"nawaystudio", true, "high"},
		{"officialshop", true, "high"},
		{"brandco", true, "high"},
		{"r.fajarnugraha", false, "low"}, // person: has dot separator
		{"tatak.subekti", false, "low"},  // person: has dot separator
		{"uitdiedos", false, "low"},      // unclear: no brand keyword
		{"giovanni", false, "low"},       // person name
		{"digitalagency", true, "high"},
		{"fashionstore", true, "high"},
	}

	for _, tc := range cases {
		t.Run(tc.local, func(t *testing.T) {
			got := Analyze(tc.local)
			if got.IsBrandHint != tc.isBrand {
				t.Errorf("Analyze(%q).IsBrandHint = %v, want %v (signals: %v)", tc.local, got.IsBrandHint, tc.isBrand, got.Signals)
			}
			if got.Confidence != tc.confidence {
				t.Errorf("Analyze(%q).Confidence = %q, want %q", tc.local, got.Confidence, tc.confidence)
			}
		})
	}
}

func TestSuggestionFormat(t *testing.T) {
	brand := Analyze("nawaystore")
	if brand.Suggestion == "" {
		t.Fatal("expected non-empty suggestion for brand")
	}
	person := Analyze("r.fajarnugraha")
	if person.Suggestion == "" {
		t.Fatal("expected non-empty suggestion for person")
	}
}
