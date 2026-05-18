package report

import (
	"fmt"
	"strings"

	"company-detector/go-service/internal/model"
)

func Render(result model.CompanyCheckResult) string {
	evidenceLines := []string{}
	for _, item := range result.Evidence {
		value := evidenceValue(item)
		if value == "" || value == "<nil>" {
			evidenceLines = append(evidenceLines, humanEvidence(item))
		} else {
			evidenceLines = append(evidenceLines, fmt.Sprintf("%s (%s)", humanEvidence(item), value))
		}
	}

	parts := []string{
		"Company Detection Report",
		"",
		"Kesimpulan:",
		conclusion(result),
		fmt.Sprintf("Classification: %s", result.Classification),
		fmt.Sprintf("Confidence: %s (%d/100)", result.ConfidenceLabel, result.ConfidenceScore),
		fmt.Sprintf("Automation: %s", result.AutomationAction),
		"",
		"Data yang berhasil dikumpulkan:",
		bullets(dataLines(result)),
		"",
		"Alur pengecekan:",
		numbered(flowLines(result)),
		"",
		"Evidence utama:",
		bullets(limit(evidenceLines, 12)),
		"",
		"Catatan proses:",
		bullets(processNotes(result)),
		"",
		"Rekomendasi automation:",
		result.Recommendation,
	}
	return strings.Join(parts, "\n")
}

func evidenceValue(item model.EvidenceItem) string {
	lower := strings.ToLower(item.Claim)
	if strings.Contains(lower, "free scraper captured") {
		return ""
	}
	value := fmt.Sprint(item.Value)
	if len(value) > 180 {
		return strings.TrimSpace(value[:180]) + "..."
	}
	return value
}

func conclusion(result model.CompanyCheckResult) string {
	headline := "Akun ini belum bisa dipastikan sebagai akun perusahaan atau personal."
	switch result.Classification {
	case model.ClassificationPossibleCompany:
		headline = "Akun ini kemungkinan adalah akun yang terafiliasi dengan perusahaan."
	case model.ClassificationPersonal:
		headline = "Akun ini lebih terlihat sebagai akun personal, belum ada sinyal bisnis yang cukup kuat."
	case model.ClassificationSuspicious:
		headline = "Akun ini perlu review karena format email atau sinyal input terlihat bermasalah."
	}

	reasons := []string{}
	email := result.EmailIntelligence
	if email.OK {
		if email.IsFreeEmail {
			reasons = append(reasons, fmt.Sprintf("email memakai provider gratis `%s`", email.Domain))
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

	if len(reasons) == 0 && strings.TrimSpace(result.Summary) != "" {
		return headline + "\nAlasannya: " + result.Summary
	}
	return headline + "\nAlasannya: " + joinHuman(reasons) + "."
}

func dataLines(result model.CompanyCheckResult) []string {
	lines := []string{fmt.Sprintf("Email: %s", result.Input.Email)}
	if result.Input.FullName != "" {
		lines = append(lines, fmt.Sprintf("Nama lengkap: %s", result.Input.FullName))
	}
	if result.Input.BrandName != "" {
		lines = append(lines, fmt.Sprintf("Nama brand: %s", result.Input.BrandName))
	}
	if result.Input.PhoneMasked != "" {
		lines = append(lines, fmt.Sprintf("No HP: %s (hanya untuk pencocokan internal)", result.Input.PhoneMasked))
	}

	email := result.EmailIntelligence
	if email.OK {
		lines = append(lines, fmt.Sprintf("Domain: %s", email.Domain))
		if email.IsFreeEmail {
			lines = append(lines, "Tipe email: free email provider")
		} else {
			lines = append(lines, "Tipe email: custom domain")
		}
		if email.IsRoleEmail {
			lines = append(lines, "Tipe mailbox: role/contact mailbox")
		}
	}
	if result.DomainChecker != nil && result.DomainChecker.OK {
		lines = append(lines, fmt.Sprintf("DNS/MX: %s", result.DomainChecker.MXStatus))
		if result.DomainChecker.WebsiteActive {
			website := "aktif"
			if result.DomainChecker.Website != nil && result.DomainChecker.Website.Title != "" {
				website = fmt.Sprintf("aktif, title: %s", result.DomainChecker.Website.Title)
			}
			lines = append(lines, fmt.Sprintf("Website domain: %s", website))
		} else {
			lines = append(lines, "Website domain: belum aktif/tidak terbaca")
		}
	}
	if result.WebsiteCrawler != nil {
		lines = append(lines, fmt.Sprintf("Halaman website terbaca: %d aktif, %d punya sinyal bisnis", result.WebsiteCrawler.ActivePageCount, result.WebsiteCrawler.SignalPageCount))
	}
	if result.DDGSearch != nil {
		if result.DDGSearch.OK {
			if len(result.DDGSearch.Results) == 0 {
				lines = append(lines, "Search publik: tidak ada hasil yang berhasil diparse")
			} else {
				lines = append(lines, fmt.Sprintf("Search publik: %d hasil", len(result.DDGSearch.Results)))
			}
		} else if result.DDGSearch.Error != "" {
			lines = append(lines, fmt.Sprintf("Search publik: gagal (%s)", simplifyError(result.DDGSearch.Error)))
		}
	}
	if result.FreeScraper != nil {
		if result.FreeScraper.OK {
			lines = append(lines, "Scraper ringan: berhasil membaca konten halaman")
		} else if result.FreeScraper.Error != "" {
			lines = append(lines, fmt.Sprintf("Scraper ringan: gagal (%s)", simplifyError(result.FreeScraper.Error)))
		}
	}
	lines = append(lines, fmt.Sprintf("Score akhir: %d/100", result.ConfidenceScore))
	return lines
}

func flowLines(result model.CompanyCheckResult) []string {
	lines := []string{}
	email := result.EmailIntelligence
	if email.OK {
		domainType := "custom domain"
		if email.IsFreeEmail {
			domainType = "free email provider"
		}
		lines = append(lines, fmt.Sprintf("Sistem memvalidasi email dan memisahkan local part `%s` dari domain `%s`. Hasilnya email valid dan domain dikenali sebagai %s.", email.Local, email.Domain, domainType))
	} else {
		lines = append(lines, "Sistem memvalidasi email terlebih dulu. Hasilnya email tidak valid, jadi pengecekan lanjutan dibatasi.")
	}

	if email.OK {
		detail := "Email intelligence mengecek apakah domain termasuk provider gratis, disposable, role mailbox, atau custom domain."
		if email.IsRoleEmail {
			detail += " Hasilnya local part terlihat seperti role/contact mailbox, jadi sinyal awal mengarah ke akun bisnis."
		} else if email.IsFreeEmail {
			detail += " Hasilnya email memakai provider gratis, jadi sistem butuh sinyal lain seperti brand, nama, atau hasil pencarian publik."
		} else {
			detail += " Hasilnya email memakai custom domain, jadi sistem masuk ke pengecekan domain."
		}
		lines = append(lines, detail)
	}

	if result.DomainChecker != nil {
		if result.DomainChecker.OK {
			websiteState := "website belum terbaca aktif"
			if result.DomainChecker.WebsiteActive {
				websiteState = "website terlihat aktif"
			}
			lines = append(lines, fmt.Sprintf("Domain checker mengecek DNS, MX, address record, dan website utama. Hasilnya MX `%s` dan %s.", result.DomainChecker.MXStatus, websiteState))
		} else {
			lines = append(lines, fmt.Sprintf("Domain checker dicoba untuk membaca DNS dan website, tapi gagal: %s.", result.DomainChecker.Error))
		}
	} else {
		lines = append(lines, "Domain checker tidak dijalankan karena input belum memenuhi syarat untuk pengecekan domain atau mode run tidak mengaktifkannya.")
	}

	if result.WebsiteCrawler != nil {
		if result.WebsiteCrawler.OK && result.WebsiteCrawler.ActivePageCount > 0 {
			lines = append(lines, fmt.Sprintf("Website crawler membaca halaman umum seperti home, about, dan contact. Hasilnya %d halaman aktif dan %d halaman punya sinyal bisnis.", result.WebsiteCrawler.ActivePageCount, result.WebsiteCrawler.SignalPageCount))
		} else {
			lines = append(lines, "Website crawler dicoba, tapi belum menemukan halaman aktif yang bisa dipakai sebagai evidence.")
		}
	}

	if result.SerpQueries != nil && result.SerpQueries.OK {
		lines = append(lines, fmt.Sprintf("Query builder menyusun %d query dari email, domain, nama, dan brand agar pencarian publik tidak asal tebak.", len(result.SerpQueries.Queries)))
	}

	if result.DDGSearch != nil {
		if result.DDGSearch.OK {
			if len(result.DDGSearch.Results) == 0 {
				lines = append(lines, "Search publik menjalankan query utama, tapi belum menemukan hasil yang bisa diparse.")
			} else {
				lines = append(lines, fmt.Sprintf("Search publik menjalankan query utama dan menemukan %d hasil yang bisa diparse.", len(result.DDGSearch.Results)))
			}
		} else {
			lines = append(lines, fmt.Sprintf("Search publik dicoba, tapi gagal atau tidak memberi hasil yang bisa dipakai: %s.", simplifyError(result.DDGSearch.Error)))
		}
	}

	if result.FreeScraper != nil {
		if result.FreeScraper.OK {
			lines = append(lines, "Scraper ringan membaca konten dari URL yang tersedia untuk menambah konteks non-berbayar.")
		} else {
			lines = append(lines, fmt.Sprintf("Scraper ringan dicoba, tapi gagal membaca konten: %s.", simplifyError(result.FreeScraper.Error)))
		}
	}

	lines = append(lines, fmt.Sprintf("Scoring engine menggabungkan semua evidence dan memberi bobot. Hasil akhirnya score %d/100, classification `%s`, dan automation action `%s`.", result.ConfidenceScore, result.Classification, result.AutomationAction))
	return lines
}

func processNotes(result model.CompanyCheckResult) []string {
	notes := []string{}
	for _, item := range result.ToolsSkipped {
		notes = append(notes, fmt.Sprintf("%s dilewati: %s.", humanToolName(item.Tool), humanReason(item.Reason)))
	}
	for _, item := range result.ToolErrors {
		notes = append(notes, fmt.Sprintf("%s gagal: %s.", humanToolName(item.Tool), simplifyError(item.Error)))
	}
	if len(notes) == 0 {
		notes = append(notes, "Tidak ada error tool yang tercatat.")
	}
	return notes
}

func humanEvidence(item model.EvidenceItem) string {
	claim := item.Claim
	lower := strings.ToLower(claim)
	switch {
	case strings.Contains(lower, "custom domain"):
		return "Domain email adalah custom domain, bukan provider email gratis"
	case strings.Contains(lower, "free email provider"):
		return "Domain email adalah provider email gratis"
	case strings.Contains(lower, "role/contact mailbox"):
		return "Local part email terlihat seperti role/contact mailbox"
	case strings.Contains(lower, "mx records"):
		return "Domain punya MX record, jadi bisa menerima email"
	case strings.Contains(lower, "resolves to address") || strings.Contains(lower, "resolves to web/server address"):
		return "Domain punya address record/server"
	case strings.Contains(lower, "website is active"):
		return "Website domain aktif"
	case strings.Contains(lower, "readable active pages"):
		return "Crawler membaca halaman website aktif"
	case strings.Contains(lower, "business/company signals"):
		return "Halaman website mengandung sinyal bisnis/perusahaan"
	case strings.Contains(lower, "signup provided a brand"):
		return "Input register menyertakan nama brand"
	case strings.Contains(lower, "search ran but returned no parsed"):
		return "Search publik berjalan, tapi tidak ada hasil yang berhasil diparse"
	case strings.Contains(lower, "free scraper captured"):
		return "Scraper ringan berhasil mengambil konten halaman"
	default:
		return claim
	}
}

func simplifyError(message string) string {
	lower := strings.ToLower(message)
	switch {
	case message == "":
		return "tidak ada detail error"
	case strings.Contains(lower, "certificate is valid for internetpositif.id"):
		return "koneksi search publik terkena blokir/redirect internetpositif, jadi hasil search tidak bisa dipakai"
	case strings.Contains(lower, "tls: failed to verify certificate"):
		return "verifikasi sertifikat TLS gagal saat mengakses provider"
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
	case "disabled_waiting_budget":
		return "belum diaktifkan karena menunggu budget/provider"
	case "not_enabled_in_go_port":
		return "belum diaktifkan di versi Go"
	default:
		return reason
	}
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

func numbered(items []string) string {
	filtered := []string{}
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			filtered = append(filtered, fmt.Sprintf("%d. %s", len(filtered)+1, item))
		}
	}
	if len(filtered) == 0 {
		return "1. Tidak ada alur yang tercatat."
	}
	return strings.Join(filtered, "\n")
}

func limit(items []string, max int) []string {
	if max <= 0 || len(items) <= max {
		return items
	}
	limited := append([]string{}, items[:max]...)
	limited = append(limited, fmt.Sprintf("%d evidence lain tersimpan di JSON report.", len(items)-max))
	return limited
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
