// Package report renders a human-readable fallback report when AI reasoning
// is not available. In normal operation, the AI reasoning loop (Phase A)
// produces the narrative investigation report. This package is the Go-side
// fallback only.
package report

import (
	"fmt"
	"strings"

	"company-detector/go-service/internal/model"
)

// Render produces a plain-text fallback report from a CompanyCheckResult.
// This is used when AI reasoning is not active. In Phase A, the AI loop
// produces the investigation narrative directly.
func Render(result model.CompanyCheckResult) string {
	parts := []string{
		"Company Detection Report",
		"[FALLBACK MODE — AI reasoning tidak aktif]",
		"",
		"Kesimpulan:",
		conclusion(result),
		fmt.Sprintf("Classification: %s", result.Classification),
		fmt.Sprintf("Confidence: %s (%d/100)", result.ConfidenceLabel, result.ConfidenceScore),
		fmt.Sprintf("Automation: %s", result.AutomationAction),
		"",
		"Input:",
		bullets(inputLines(result)),
		"",
		fallbackSummary(result),
		"",
		scoringSummary(result),
		"",
		"Rekomendasi automation:",
		result.Recommendation,
	}
	return strings.Join(parts, "\n")
}

// ── Input section ─────────────────────────────────────────────────────────────

func inputLines(result model.CompanyCheckResult) []string {
	lines := []string{fmt.Sprintf("Email: %s", result.Input.Email)}
	if result.Input.FullName != "" {
		lines = append(lines, fmt.Sprintf("Nama lengkap: %s", result.Input.FullName))
	}
	if result.Input.BrandName != "" {
		lines = append(lines, fmt.Sprintf("Brand/company: %s", result.Input.BrandName))
	}
	if result.Input.PhoneMasked != "" {
		lines = append(lines, fmt.Sprintf("No HP: %s (untuk konfirmasi — jika nemu nomor ini di website/marketplace/WA Business, itu konfirmasi kuat)", result.Input.PhoneMasked))
	}
	return lines
}

// ── Conclusion section ────────────────────────────────────────────────────────

func conclusion(result model.CompanyCheckResult) string {
	headline := "Akun ini belum bisa dipastikan sebagai akun perusahaan atau personal."
	switch result.Classification {
	case model.ClassificationPossibleCompany:
		headline = "Akun ini kemungkinan adalah akun yang terafiliasi dengan perusahaan."
	case model.ClassificationPersonal:
		headline = "Akun ini lebih terlihat sebagai akun personal — belum ada sinyal bisnis yang cukup kuat dari investigasi yang bisa dijalankan saat ini."
	case model.ClassificationSuspicious:
		headline = "Akun ini perlu review karena format email atau sinyal input terlihat bermasalah."
	}

	reasons := []string{}
	email := result.EmailIntelligence
	if email.OK {
		if email.IsFreeEmail {
			reasons = append(reasons, fmt.Sprintf("email memakai provider gratis `%s`, bukan custom domain perusahaan", email.Domain))
		} else {
			reasons = append(reasons, fmt.Sprintf("email memakai custom domain `%s`", email.Domain))
		}
		if email.IsRoleEmail {
			reasons = append(reasons, fmt.Sprintf("local part `%s` terlihat seperti alamat role/contact", email.Local))
		}
	} else if email.Error != "" {
		reasons = append(reasons, fmt.Sprintf("email tidak valid: %s", email.Error))
	}
	if result.Input.BrandName != "" {
		reasons = append(reasons, fmt.Sprintf("input register membawa nama brand `%s`", result.Input.BrandName))
	}
	if result.DomainChecker != nil && result.DomainChecker.OK {
		if result.DomainChecker.WebsiteActive {
			reasons = append(reasons, "website domain aktif")
		}
		if result.DomainChecker.MXStatus != "" {
			reasons = append(reasons, fmt.Sprintf("status MX domain: %s", result.DomainChecker.MXStatus))
		}
	}
	if result.WebsiteCrawler != nil && result.WebsiteCrawler.OK && result.WebsiteCrawler.SignalPageCount > 0 {
		reasons = append(reasons, fmt.Sprintf("%d halaman website punya sinyal bisnis", result.WebsiteCrawler.SignalPageCount))
	}
	if result.DDGSearch != nil && result.DDGSearch.OK && len(result.DDGSearch.Results) > 0 {
		reasons = append(reasons, fmt.Sprintf("search publik menemukan %d hasil", len(result.DDGSearch.Results)))
	}

	gaps := missingEvidence(result)
	base := headline + "\nAlasannya: "
	if len(reasons) == 0 && strings.TrimSpace(result.Summary) != "" {
		base += result.Summary
	} else {
		base += joinHuman(reasons) + "."
	}
	if gaps != "" {
		base += "\n" + gaps
	}
	return base
}

func missingEvidence(result model.CompanyCheckResult) string {
	email := result.EmailIntelligence
	if !email.OK {
		return ""
	}
	gaps := []string{}
	if email.IsFreeEmail {
		if result.DDGSearch == nil || (result.DDGSearch.OK && len(result.DDGSearch.Results) == 0) {
			gaps = append(gaps, "pencarian publik tidak menemukan profil bisnis atau afiliasi perusahaan atas nama ini")
		}
		if result.Input.BrandName == "" {
			gaps = append(gaps, "tidak ada brand/company name dari data register")
		}
		gaps = append(gaps, "untuk menaikkan confidence: butuh profil publik yang menyebut peran bisnis, atau brand name yang bisa dikonfirmasi ke domain perusahaan")
	} else {
		if result.DomainChecker == nil || !result.DomainChecker.WebsiteActive {
			gaps = append(gaps, "website domain belum terkonfirmasi aktif")
		}
		if result.WebsiteCrawler == nil || result.WebsiteCrawler.SignalPageCount == 0 {
			gaps = append(gaps, "belum ada halaman website yang mengandung sinyal bisnis eksplisit")
		}
	}
	if len(gaps) == 0 {
		return ""
	}
	return "Yang masih kurang: " + strings.Join(gaps, "; ") + "."
}

// ── Fallback summary ──────────────────────────────────────────────────────────
// fallbackSummary shows which tools ran, which failed, and which were skipped.
// This replaces the detailed investigationSteps() that the AI now handles in Phase A.

func fallbackSummary(result model.CompanyCheckResult) string {
	var sb strings.Builder
	sb.WriteString("[Fallback Mode] AI reasoning tidak aktif. Untuk investigasi lebih dalam, jalankan ulang saat AI tersedia.\n")

	// Tools yang berhasil dijalankan
	if len(result.ToolsUsed) > 0 {
		sb.WriteString("\nTools dijalankan:\n")
		for _, t := range result.ToolsUsed {
			sb.WriteString("- " + t + "\n")
		}
	} else {
		sb.WriteString("\nTools dijalankan: (tidak ada)\n")
	}

	// Tools yang gagal
	if len(result.ToolErrors) > 0 {
		sb.WriteString("\nTools gagal:\n")
		for _, te := range result.ToolErrors {
			sb.WriteString(fmt.Sprintf("- %s: %s\n", te.Tool, simplifyError(te.Error)))
		}
	}

	// Tools yang dilewati
	if len(result.ToolsSkipped) > 0 {
		sb.WriteString("\nTools dilewati:\n")
		for _, ts := range result.ToolsSkipped {
			sb.WriteString(fmt.Sprintf("- %s: %s\n", ts.Tool, humanReason(ts.Reason)))
		}
	}

	// Evidence count
	sb.WriteString(fmt.Sprintf("\nEvidence terkumpul: %d item\n", len(result.Evidence)))

	return strings.TrimRight(sb.String(), "\n")
}

// ── Scoring summary ───────────────────────────────────────────────────────────

func scoringSummary(result model.CompanyCheckResult) string {
	var sb strings.Builder
	sb.WriteString("[Deterministik] Scoring Engine — Kesimpulan Akhir\n")
	sb.WriteString("  Algoritma : base_score + sum(verified_evidence_delta), clamp 0–100\n")
	sb.WriteString("  Base score : 35\n")
	sb.WriteString(fmt.Sprintf("  Total delta: %+d\n", result.Scoring.EvidenceDelta))
	if result.Scoring.RejectedEvidence > 0 {
		sb.WriteString(fmt.Sprintf("  Ditolak    : %d evidence AI tanpa source URL/tool call — tidak dihitung ke score\n", result.Scoring.RejectedEvidence))
		sb.WriteString("  Alasan     : klaim tanpa verifiable source dianggap tidak valid (anti-hallucination)\n")
	}
	sb.WriteString(fmt.Sprintf("  Final score: %d/100 (%s)\n", result.ConfidenceScore, result.ConfidenceLabel))
	sb.WriteString(fmt.Sprintf("  Artinya    : classification `%s`, action `%s`\n", result.Classification, result.AutomationAction))
	skippedBudget := []string{}
	for _, sk := range result.ToolsSkipped {
		if sk.Reason == "disabled_waiting_budget" {
			skippedBudget = append(skippedBudget, humanToolName(sk.Tool))
		}
	}
	if len(skippedBudget) > 0 {
		sb.WriteString(fmt.Sprintf("  Bisa naik  : aktifkan %s untuk evidence lebih kuat\n", strings.Join(skippedBudget, ", ")))
	}
	return strings.TrimRight(sb.String(), "\n")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func simplifySearchError(message string) string {
	if strings.HasPrefix(message, "all_providers_failed:") {
		return "semua provider gagal — " + strings.TrimPrefix(message, "all_providers_failed: ")
	}
	return simplifyError(message)
}

func simplifyError(message string) string {
	lower := strings.ToLower(message)
	switch {
	case message == "":
		return "tidak ada detail error"
	case strings.Contains(lower, "certificate is valid for internetpositif.id"):
		return "koneksi terkena blokir/redirect internetpositif"
	case strings.Contains(lower, "tls: failed to verify certificate"):
		return "verifikasi sertifikat TLS gagal"
	case strings.Contains(lower, "no such host"):
		return "host tidak bisa di-resolve"
	case strings.Contains(lower, "context deadline exceeded") || strings.Contains(lower, "client.timeout"):
		return "request timeout"
	default:
		return message
	}
}

func humanToolName(tool string) string {
	switch tool {
	case "firecrawl":
		return "Firecrawl"
	case "tavily_or_serpapi":
		return "Tavily/SerpAPI"
	case "paid_enrichment":
		return "Paid enrichment"
	case "browser_agent":
		return "Browser agent"
	case "ddg_search":
		return "DuckDuckGo search"
	default:
		return tool
	}
}

func humanReason(reason string) string {
	switch reason {
	case "free_email_provider":
		return "tidak relevan untuk free email — tidak ada company domain yang bisa dicek"
	case "no_active_url_to_scrape":
		return "tidak ada URL aktif yang ditemukan untuk di-scrape"
	case "invalid_email":
		return "email tidak valid, tool tidak bisa dijalankan"
	case "network_disabled":
		return "mode network dinonaktifkan (test/offline mode)"
	case "no_search_query_available":
		return "tidak ada query yang bisa dibentuk dari input"
	case "disabled_waiting_budget":
		return "belum aktif — menunggu budget/API key provider"
	case "not_enabled_in_go_port":
		return "belum diaktifkan di versi Go saat ini"
	default:
		return reason
	}
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

func bullets(items []string) string {
	filtered := []string{}
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			filtered = append(filtered, "- "+item)
		}
	}
	if len(filtered) == 0 {
		return "- Tidak ada."
	}
	return strings.Join(filtered, "\n")
}

func joinHuman(items []string) string {
	filtered := []string{}
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			filtered = append(filtered, item)
		}
	}
	if len(filtered) == 0 {
		return "belum ada alasan yang cukup"
	}
	if len(filtered) == 1 {
		return filtered[0]
	}
	return strings.Join(filtered[:len(filtered)-1], ", ") + ", dan " + filtered[len(filtered)-1]
}

// simplifySearchError is exported for use in tests; keep the unexported alias
// above for internal use.
var _ = simplifySearchError
