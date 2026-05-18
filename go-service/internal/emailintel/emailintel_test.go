package emailintel

import "testing"

func TestAnalyzeCustomRoleEmail(t *testing.T) {
	got := Analyze("contact@komerce.id")
	if !got.OK || got.Domain != "komerce.id" || got.IsFreeEmail || !got.IsRoleEmail {
		t.Fatalf("unexpected email intelligence: %#v", got)
	}
}

func TestAnalyzeFreeEmail(t *testing.T) {
	got := Analyze("person@gmail.com")
	if !got.OK || !got.IsFreeEmail || got.InitialSuspicion != "free_email_needs_more_evidence" {
		t.Fatalf("unexpected free email: %#v", got)
	}
}

func TestAnalyzeInvalidEmail(t *testing.T) {
	got := Analyze("not-an-email")
	if got.OK || got.Error != "invalid_email" {
		t.Fatalf("expected invalid email, got %#v", got)
	}
}
