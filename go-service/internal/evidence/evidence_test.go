package evidence

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"company-detector/go-service/internal/model"
)

func TestStoreWritesEvidenceReportAndAudit(t *testing.T) {
	base := t.TempDir()
	result := model.CompanyCheckResult{
		ObservedAt:       "2026-05-18T03:00:00Z",
		Input:            model.RegisterInput{Email: "contact@komerce.id"},
		Classification:   model.ClassificationPossibleCompany,
		ConfidenceScore:  80,
		CompanyDetected:  true,
		TelegramReport:   "report body",
		AutomationAction: model.ActionRouteCompany,
	}
	paths, err := Store(result, Options{BaseDir: base, Now: func() time.Time { return time.Date(2026, 5, 18, 3, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	for _, path := range []string{paths.EvidenceFile, paths.LatestFile, paths.ReportFile, paths.AuditFile} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected file %s: %v", path, err)
		}
	}
	if filepath.Base(paths.LatestFile) != "latest.json" {
		t.Fatalf("unexpected latest path %s", paths.LatestFile)
	}
}
