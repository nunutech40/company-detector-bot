package evidence

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"company-detector/go-service/internal/model"
)

type Options struct {
	BaseDir string
	Now     func() time.Time
}

type StoredPaths struct {
	EvidenceFile string `json:"evidence_file"`
	LatestFile   string `json:"latest_file"`
	ReportFile   string `json:"report_file"`
	AuditFile    string `json:"audit_file"`
}

func Store(result model.CompanyCheckResult, options Options) (StoredPaths, error) {
	baseDir := options.BaseDir
	if baseDir == "" {
		baseDir = ".."
	}
	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	evidenceDir := filepath.Join(baseDir, "evidence")
	reportDir := filepath.Join(baseDir, "reports")
	if err := os.MkdirAll(evidenceDir, 0o755); err != nil {
		return StoredPaths{}, err
	}
	if err := os.MkdirAll(reportDir, 0o755); err != nil {
		return StoredPaths{}, err
	}

	filename := safeName(result.Input.Email) + "-" + shortHash(result.Input.Email+result.ObservedAt) + ".json"
	evidencePath := filepath.Join(evidenceDir, filename)
	latestPath := filepath.Join(evidenceDir, "latest.json")
	reportPath := filepath.Join(reportDir, strings.TrimSuffix(filename, ".json")+".txt")
	auditPath := filepath.Join(evidenceDir, "audit.jsonl")

	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return StoredPaths{}, err
	}
	if err := os.WriteFile(evidencePath, data, 0o600); err != nil {
		return StoredPaths{}, err
	}
	if err := os.WriteFile(latestPath, data, 0o600); err != nil {
		return StoredPaths{}, err
	}
	if err := os.WriteFile(reportPath, []byte(result.TelegramReport+"\n"), 0o600); err != nil {
		return StoredPaths{}, err
	}
	audit := map[string]interface{}{
		"observed_at":      now().UTC().Format(time.RFC3339),
		"email":            result.Input.Email,
		"classification":   result.Classification,
		"confidence_score": result.ConfidenceScore,
		"company_detected": result.CompanyDetected,
		"evidence_file":    evidencePath,
		"report_file":      reportPath,
	}
	line, _ := json.Marshal(audit)
	file, err := os.OpenFile(auditPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return StoredPaths{}, err
	}
	defer file.Close()
	if _, err := fmt.Fprintln(file, string(line)); err != nil {
		return StoredPaths{}, err
	}
	return StoredPaths{EvidenceFile: evidencePath, LatestFile: latestPath, ReportFile: reportPath, AuditFile: auditPath}, nil
}

func safeName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = regexp.MustCompile(`[^a-z0-9@._-]+`).ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if value == "" {
		return "unknown"
	}
	if len(value) > 80 {
		return value[:80]
	}
	return value
}

func shortHash(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])[:12]
}
