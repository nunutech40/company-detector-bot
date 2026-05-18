// Package rolesignal detects business role signals (founder, CEO, owner, etc.)
// from text snippets. Used by the AI reasoning loop to extract role evidence
// from search results, social media bios, and website content.
package rolesignal

import (
	"regexp"
	"strings"
)

// RoleSignal represents a detected role mention in text.
type RoleSignal struct {
	Role       string // normalized role: "founder", "owner", "ceo", "director", "employee"
	RawText    string // the exact phrase that triggered detection
	Confidence string // "high", "medium", "low"
	Context    string // surrounding text for verification
}

// Result holds all role signals found in the text.
type Result struct {
	Signals        []RoleSignal
	StrongestRole  string // highest confidence role found
	HasOwnerSignal bool   // true if founder/owner/CEO found
}

// rolePatterns maps role keywords to normalized roles and confidence levels.
// Indonesian and English patterns included.
var rolePatterns = []struct {
	pattern    *regexp.Regexp
	role       string
	confidence string
}{
	// High confidence: explicit founder/owner/CEO
	{regexp.MustCompile(`(?i)\b(?:founder|co-founder|cofounder)\b`), "founder", "high"},
	{regexp.MustCompile(`(?i)\b(?:owner|pemilik|punya)\b`), "owner", "high"},
	{regexp.MustCompile(`(?i)\b(?:ceo|chief executive|direktur utama)\b`), "ceo", "high"},
	{regexp.MustCompile(`(?i)\b(?:direktur|director)\b`), "director", "high"},
	{regexp.MustCompile(`(?i)\b(?:president|presiden)\b`), "president", "high"},

	// High confidence: contextual owner language (Indonesian marketplace patterns)
	{regexp.MustCompile(`(?i)harga dari owner`), "owner", "high"},
	{regexp.MustCompile(`(?i)rek(?:ening)?\s+(?:a\.n|atas\s+nama)\s+\w+`), "owner", "high"},
	{regexp.MustCompile(`(?i)transfer\s+(?:bca|bni|bri|mandiri|gopay|ovo)\s+\w+`), "owner", "medium"},
	{regexp.MustCompile(`(?i)wa(?:tsapp)?\s*(?:owner|admin|cs)`), "owner", "medium"},

	// Medium confidence: management roles
	{regexp.MustCompile(`(?i)\b(?:cto|coo|cfo|chief)\b`), "c-level", "medium"},
	{regexp.MustCompile(`(?i)\b(?:manager|manajer|kepala)\b`), "manager", "medium"},
	{regexp.MustCompile(`(?i)\b(?:head of|lead|pemimpin)\b`), "lead", "medium"},
	{regexp.MustCompile(`(?i)\b(?:partner|mitra)\b`), "partner", "medium"},

	// Low confidence: general business affiliation
	{regexp.MustCompile(`(?i)\b(?:staff|karyawan|pegawai|employee)\b`), "employee", "low"},
	{regexp.MustCompile(`(?i)\b(?:freelancer|konsultan|consultant)\b`), "freelancer", "low"},
}

// Extract finds all role signals in the given text.
// Input: any text — search snippet, bio, page content, etc.
func Extract(text string) Result {
	signals := []RoleSignal{}
	strongestRole := ""
	hasOwner := false

	for _, rp := range rolePatterns {
		matches := rp.pattern.FindAllStringIndex(text, -1)
		for _, loc := range matches {
			rawText := text[loc[0]:loc[1]]
			context := extractContext(text, loc[0], loc[1], 60)

			signals = append(signals, RoleSignal{
				Role:       rp.role,
				RawText:    rawText,
				Confidence: rp.confidence,
				Context:    context,
			})

			if rp.confidence == "high" {
				if strongestRole == "" {
					strongestRole = rp.role
				}
				if rp.role == "founder" || rp.role == "owner" || rp.role == "ceo" {
					hasOwner = true
					strongestRole = rp.role
				}
			} else if rp.confidence == "medium" && strongestRole == "" {
				strongestRole = rp.role
			}
		}
	}

	return Result{
		Signals:        signals,
		StrongestRole:  strongestRole,
		HasOwnerSignal: hasOwner,
	}
}

// ExtractFromSnippets runs extraction on multiple text snippets and aggregates results.
// Useful for processing multiple search result snippets at once.
func ExtractFromSnippets(snippets []string) Result {
	combined := strings.Join(snippets, " | ")
	return Extract(combined)
}

// extractContext returns surrounding text around a match position.
func extractContext(text string, start, end, radius int) string {
	ctxStart := start - radius
	if ctxStart < 0 {
		ctxStart = 0
	}
	ctxEnd := end + radius
	if ctxEnd > len(text) {
		ctxEnd = len(text)
	}
	ctx := strings.TrimSpace(text[ctxStart:ctxEnd])
	// Add ellipsis if truncated
	if ctxStart > 0 {
		ctx = "..." + ctx
	}
	if ctxEnd < len(text) {
		ctx = ctx + "..."
	}
	return ctx
}
