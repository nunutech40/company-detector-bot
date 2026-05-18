package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type AuditEntry struct {
	ObservedAt      string `json:"observed_at"`
	Email           string `json:"email"`
	Classification  string `json:"classification"`
	ConfidenceScore int    `json:"confidence_score"`
	CompanyDetected bool   `json:"company_detected"`
	EvidenceFile    string `json:"evidence_file"`
	ReportFile      string `json:"report_file"`
	ReportPath      string `json:"report_path"`
}

type Result struct {
	OK     bool        `json:"ok"`
	Error  string      `json:"error,omitempty"`
	Email  string      `json:"email,omitempty"`
	Audit  *AuditEntry `json:"audit,omitempty"`
	Report string      `json:"report,omitempty"`
}

func main() {
	jsonOutput := flag.Bool("json", false, "print JSON result")
	baseDir := flag.String("base-dir", "..", "base directory containing evidence/")
	flag.Parse()

	email := ""
	if flag.NArg() > 0 {
		email = strings.ToLower(strings.TrimSpace(flag.Arg(0)))
	}
	result := loadLastReport(*baseDir, email)
	if *jsonOutput {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		if !result.OK {
			os.Exit(1)
		}
		return
	}
	if result.OK && result.Report != "" {
		fmt.Println(result.Report)
		return
	}
	fmt.Println("Belum ada report tersimpan untuk filter tersebut.")
	os.Exit(1)
}

func loadLastReport(baseDir, email string) Result {
	auditPath := filepath.Join(baseDir, "evidence", "audit.jsonl")
	entry, err := findAudit(auditPath, email)
	if err != nil {
		return Result{OK: false, Error: err.Error(), Email: email}
	}
	if entry == nil {
		return Result{OK: false, Error: "last_report_not_found", Email: email}
	}
	reportPath := entry.ReportFile
	if reportPath == "" {
		reportPath = entry.ReportPath
	}
	report, err := os.ReadFile(filepath.Clean(reportPath))
	if err != nil {
		return Result{OK: true, Audit: entry, Report: ""}
	}
	return Result{OK: true, Audit: entry, Report: strings.TrimSpace(string(report))}
}

func findAudit(path, email string) (*AuditEntry, error) {
	file, err := os.Open(filepath.Clean(path))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	entries := []AuditEntry{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry AuditEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		entries = append(entries, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	for index := len(entries) - 1; index >= 0; index-- {
		if email == "" || strings.EqualFold(entries[index].Email, email) {
			return &entries[index], nil
		}
	}
	return nil, nil
}
