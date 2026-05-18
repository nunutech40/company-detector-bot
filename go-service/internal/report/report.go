package report

import (
	"fmt"
	"strings"

	"company-detector/go-service/internal/model"
)

func Render(result model.CompanyCheckResult) string {
	success := []string{}
	failed := []string{}
	skipped := []string{}

	email := result.EmailIntelligence
	if email.OK {
		success = append(success, "Email berhasil diparse.")
		success = append(success, fmt.Sprintf("Domain `%s` berhasil diekstrak.", email.Domain))
		if email.IsFreeEmail {
			success = append(success, "Domain dikenali sebagai free email provider.")
		} else {
			success = append(success, "Domain dikenali sebagai custom domain, bukan free email provider.")
		}
		if email.IsRoleEmail {
			success = append(success, "Local part terdeteksi sebagai role/contact mailbox.")
		}
	} else {
		failed = append(failed, "Email tidak valid.")
	}

	if result.DomainChecker != nil {
		if result.DomainChecker.OK {
			success = append(success, fmt.Sprintf("DNS/domain check selesai: MX %s.", result.DomainChecker.MXStatus))
			if result.DomainChecker.WebsiteActive {
				success = append(success, "Website domain terlihat aktif.")
			} else {
				failed = append(failed, "Website domain tidak aktif/tidak terbaca pada MVP check.")
			}
		} else {
			failed = append(failed, fmt.Sprintf("Domain checker gagal: %s.", result.DomainChecker.Error))
		}
	} else if result.EmailIntelligence.IsFreeEmail || !result.EmailIntelligence.OK {
		skipped = append(skipped, "Domain checker dilewati karena email memakai free provider atau input invalid.")
	} else {
		skipped = append(skipped, "Domain checker belum dijalankan pada mode ini.")
	}

	if result.WebsiteCrawler != nil {
		if result.WebsiteCrawler.OK && result.WebsiteCrawler.ActivePageCount > 0 {
			success = append(success, fmt.Sprintf("Website crawler membaca %d halaman aktif.", result.WebsiteCrawler.ActivePageCount))
		} else {
			skipped = append(skipped, "Website crawler tidak menemukan halaman aktif yang terbaca.")
		}
	}

	for _, item := range result.ToolsSkipped {
		skipped = append(skipped, fmt.Sprintf("%s: %s.", item.Tool, item.Reason))
	}
	for _, item := range result.ToolErrors {
		failed = append(failed, fmt.Sprintf("%s: %s.", item.Tool, item.Error))
	}

	evidenceLines := []string{}
	for _, item := range result.Evidence {
		value := fmt.Sprint(item.Value)
		if value == "" || value == "<nil>" {
			evidenceLines = append(evidenceLines, item.Claim)
		} else {
			evidenceLines = append(evidenceLines, fmt.Sprintf("%s (%s)", item.Claim, value))
		}
	}

	inputLines := []string{fmt.Sprintf("- Email: %s", result.Input.Email)}
	if result.Input.FullName != "" {
		inputLines = append(inputLines, fmt.Sprintf("- Full name: %s", result.Input.FullName))
	}
	if result.Input.BrandName != "" {
		inputLines = append(inputLines, fmt.Sprintf("- Brand name: %s", result.Input.BrandName))
	}
	if result.Input.PhoneMasked != "" {
		inputLines = append(inputLines, fmt.Sprintf("- No HP: %s (internal matching only)", result.Input.PhoneMasked))
	}

	parts := []string{
		"Company Detection MVP Report",
		"",
		"Input:",
		strings.Join(inputLines, "\n"),
		"",
		"Kesimpulan final sementara:",
		result.Summary,
		fmt.Sprintf("Classification: %s", result.Classification),
		fmt.Sprintf("Confidence: %s (%d/100)", result.ConfidenceLabel, result.ConfidenceScore),
		"",
		"Proses berhasil:",
		bullets(success),
		"",
		"Proses gagal:",
		bullets(failed),
		"",
		"Proses dilewati / belum tersedia:",
		bullets(skipped),
		"",
		"Evidence:",
		bullets(evidenceLines),
		"",
		"Rekomendasi automation:",
		result.Recommendation,
	}
	return strings.Join(parts, "\n")
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
