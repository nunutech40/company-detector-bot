package domaincheck

import (
	"context"
	"testing"
)

func TestCheckRejectsInvalidDomain(t *testing.T) {
	result := Check(context.Background(), "bad domain", Options{})
	if result.OK || result.Error != "invalid_domain" {
		t.Fatalf("expected invalid_domain, got ok=%v error=%q", result.OK, result.Error)
	}
	if len(result.Evidence) == 0 {
		t.Fatal("expected validation evidence")
	}
}
