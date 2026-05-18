package orchestrator

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	inputpkg "company-detector/go-service/internal/input"
	"company-detector/go-service/internal/model"
)

func TestNetworkFreeFixtureDecisions(t *testing.T) {
	cases := []struct {
		file           string
		classification model.Classification
		action         model.AutomationAction
	}{
		{"email_custom_domain.json", model.ClassificationPossibleCompany, model.ActionRouteCompany},
		{"email_free_only.json", model.ClassificationPersonal, model.ActionContinue},
		{"email_free_with_brand.json", model.ClassificationUnknown, model.ActionStoreUnknown},
		{"email_free_with_full_name.json", model.ClassificationPersonal, model.ActionContinue},
		{"email_invalid.json", model.ClassificationSuspicious, model.ActionRiskReview},
		{"email_disposable.json", model.ClassificationSuspicious, model.ActionRiskReview},
		{"role_mailbox.json", model.ClassificationPossibleCompany, model.ActionRouteCompany},
		{"input_with_ignored_username.json", model.ClassificationUnknown, model.ActionStoreUnknown},
	}

	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			raw := readFixture(t, tc.file)
			normalized := inputpkg.Normalize(raw)
			result := Run(context.Background(), normalized, Options{SkipNetwork: true})
			if result.Classification != tc.classification {
				t.Fatalf("classification = %s, want %s", result.Classification, tc.classification)
			}
			if result.AutomationAction != tc.action {
				t.Fatalf("action = %s, want %s", result.AutomationAction, tc.action)
			}
		})
	}
}

func readFixture(t *testing.T, name string) map[string]string {
	t.Helper()
	path := filepath.Join("..", "..", "test-fixtures", "inputs", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	raw := map[string]string{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("parse fixture %s: %v", name, err)
	}
	return raw
}
