package report

import (
	"fmt"
	"strings"

	"company-detector/go-service/internal/model"
)

func Render(result model.CompanyCheckResult) string {
	parts := []string{
		"Company Detection Report",
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
		"Proses investigasi:",
		investigationSteps(result),
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
		lines = append(lines, fmt.Sprintf("No HP: %s (internal only)", result.Input.PhoneMasked))
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

// ── Investigation steps ───────────────────────────────────────────────────────
// Each step shows: tool, action, result, hypothesis update, score delta.

func investigationSteps(result model.CompanyCheckResult) string {
	email := result.EmailIntelligence

	// Aggregate delta per source type from all evidence
	deltaBySource := map[string]int{}
	for _, ev := range result.Evidence {
		deltaBySource[ev.SourceType] += ev.ConfidenceDelta
	}
	// Sub-struct evidence (domain checker, crawler) may not be in top-level list
	if result.DomainChecker != nil {
		for _, ev := range result.DomainChecker.Evidence {
			deltaBySource["_domain"] += ev.ConfidenceDelta
		}
	}
	if result.WebsiteCrawler != nil {
		for _, ev := range result.WebsiteCrawler.Evidence {
			deltaBySource["_crawler"] += ev.ConfidenceDelta
		}
	}

	runningScore := 35
	steps := []string{}

	// [1] Email Intelligence
	steps = append(steps, stepEmailIntel(email, result.Input, deltaBySource, &runningScore))
	if !email.OK {
		steps = append(steps, scoringSummary(result))
		return strings.Join(steps, "\n")
	}

	// [2] Routing Decision
	steps = append(steps, stepRouting(email, result.Input))

	// [3] Domain Checker (custom domain only)
	if result.DomainChecker != nil {
		steps = append(steps, stepDomainChecker(result.DomainChecker, email.Domain, deltaBySource, &runningScore))
	} else if !email.IsFreeEmail {
		steps = append(steps, "[3] Domain Checker\n  Hasil    : DILEWATI — network disabled atau mode test\n  Delta    : 0\n")
	}

	// [4] Website Crawler (custom domain only)
	if result.WebsiteCrawler != nil {
		stepNum := 4
		if email.IsFreeEmail {
			stepNum = 3
		}
		steps = append(steps, stepCrawler(result.WebsiteCrawler, stepNum, deltaBySource, &runningScore))
	}

	// [3 or 5] Query Builder + Search
	if result.SerpQueries != nil && result.SerpQueries.OK {
		stepNum := 5
		if email.IsFreeEmail {
			stepNum = 3
		}
		steps = append(steps, stepSearch(result, email, stepNum, deltaBySource, &runningScore))
	}

	// [4 or 6] Free Scraper
	if result.FreeScraper != nil {
		stepNum := 6
		if email.IsFreeEmail {
			stepNum = 4
		}
		steps = append(steps, stepScraper(result.FreeScraper, stepNum, deltaBySource, &runningScore))
	}

	// [+] Brand name from register
	brandDelta := deltaBySource["registration_input"]
	if brandDelta != 0 && result.Input.BrandName != "" {
		runningScore += brandDelta
		steps = append(steps, fmt.Sprintf(
			"[+] Register Input — Brand Name\n  Tindakan : baca field brand_name dari data register\n  Hasil    : brand `%s` tersedia\n  Hipotesis: SEDIKIT MENGUAT — ada sinyal bisnis dari data register\n  Delta    : %+d → score sementara %d/100\n",
			result.Input.BrandName, brandDelta, clamp(runningScore),
		))
	}

	// [SCORING] Final
	steps = append(steps, scoringSummary(result))
	return strings.Join(steps, "\n")
}

func stepEmailIntel(email model.EmailIntelligence, input model.RegisterInput, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString("[1] Email Intelligence  [ALGO]\n")
	if !email.OK {
		sb.WriteString(fmt.Sprintf("  Tindakan : validasi format email `%s`\n", input.Email))
		sb.WriteString(fmt.Sprintf("  Hasil    : TIDAK VALID — %s\n", email.Error))
		sb.WriteString("  Hipotesis: investigasi dihentikan\n")
		sb.WriteString("  Delta    : -30 (invalid input)\n")
		sb.WriteString("  Status   : OK — format check sudah cukup untuk input ini\n")
		return sb.String()
	}
	domainType := "custom domain"
	if email.IsFreeEmail {
		domainType = "free email provider"
	}
	if email.IsDisposable {
		domainType = "disposable email (suspicious)"
	}
	sb.WriteString(fmt.Sprintf("  Tindakan : parse dan klasifikasi email `%s`\n", email.Email))
	sb.WriteString(fmt.Sprintf("  Hasil    : local=`%s`, domain=`%s`, tipe=%s", email.Local, email.Domain, domainType))
	if email.IsRoleEmail {
		sb.WriteString(fmt.Sprintf(", role mailbox=ya (local `%s` adalah alamat bisnis)", email.Local))
	}
	sb.WriteString("\n")
	delta := deltaBySource["email_domain"] + deltaBySource["email_local_part"] + deltaBySource["input_validation"]
	*running += delta
	sb.WriteString(fmt.Sprintf("  Hipotesis: %s\n", initialHypothesis(email, input)))
	sb.WriteString(fmt.Sprintf("  Delta    : %+d → score sementara %d/100\n", delta, clamp(*running)))
	// improvement hint
	if email.IsFreeEmail {
		sb.WriteString("  Status   : OK — free domain list sudah cukup luas; bisa diperluas dengan disposable DB lebih lengkap\n")
	} else {
		sb.WriteString("  Status   : OK — custom domain detection sudah deterministik dan reliable\n")
	}
	return sb.String()
}

func stepRouting(email model.EmailIntelligence, input model.RegisterInput) string {
	var sb strings.Builder
	sb.WriteString("[2] Routing Decision  [ALGO]\n")
	sb.WriteString("  Tindakan : tentukan jalur investigasi berdasarkan tipe email\n")
	if email.IsFreeEmail {
		sb.WriteString("  Hasil    : free email → domain checker dan website crawler DILEWATI\n")
		sb.WriteString("  Alasan   : tidak ada company domain yang bisa dicek dari email gratis\n")
		nameHint := email.Local
		if input.FullName != "" {
			nameHint = input.FullName
		}
		sb.WriteString(fmt.Sprintf("  Jalur    : investigasi dialihkan ke pencarian publik (nama: `%s`)\n", nameHint))
		sb.WriteString("  Status   : OK — routing sudah benar; improve dengan menambah brand_name sebagai sinyal routing tambahan\n")
	} else {
		sb.WriteString("  Hasil    : custom domain → lanjut ke domain checker dan website crawler\n")
		sb.WriteString("  Jalur    : cek DNS, MX, website, dan halaman-halaman bisnis\n")
		sb.WriteString("  Status   : OK — routing deterministik dan sudah sesuai\n")
	}
	sb.WriteString("  Delta    : 0 (routing tidak mengubah score)\n")
	return sb.String()
}

func stepDomainChecker(dc *model.DomainCheck, domain string, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString("[3] Domain Checker  [TOOL — DNS + HTTP]\n")
	sb.WriteString(fmt.Sprintf("  Tindakan : cek DNS (MX, A/AAAA), dan probe website `%s`\n", domain))
	if !dc.OK {
		sb.WriteString(fmt.Sprintf("  Hasil    : GAGAL — %s\n", simplifyError(dc.Error)))
		sb.WriteString("  Hipotesis: TIDAK BERUBAH — tidak bisa konfirmasi atau tolak dari domain\n")
		sb.WriteString("  Delta    : 0\n")
		sb.WriteString("  Status   : PERLU IMPROVE — timeout/retry policy bisa ditambah; fallback ke HTTP jika HTTPS gagal\n")
		return sb.String()
	}
	websiteDesc := "tidak aktif"
	if dc.WebsiteActive && dc.Website != nil && dc.Website.Title != "" {
		websiteDesc = fmt.Sprintf("aktif, title: `%s`", dc.Website.Title)
	} else if dc.WebsiteActive {
		websiteDesc = "aktif"
	}
	sb.WriteString(fmt.Sprintf("  Hasil    : MX=%s, website=%s\n", dc.MXStatus, websiteDesc))
	delta := deltaBySource["_domain"] + deltaBySource["dns_mx"] + deltaBySource["dns_address"] + deltaBySource["company_website"] + deltaBySource["domain_validation"]
	*running += delta
	if dc.WebsiteActive {
		sb.WriteString("  Hipotesis: MENGUAT — domain punya infrastruktur email dan website aktif\n")
		sb.WriteString("  Status   : OK — DNS + HTTP probe sudah cukup untuk MVP; improve dengan schema.org extraction\n")
	} else {
		sb.WriteString("  Hipotesis: TETAP — domain ada tapi website belum terkonfirmasi aktif\n")
		sb.WriteString("  Status   : PERLU IMPROVE — website tidak aktif bisa false negative; coba HTTP fallback atau retry\n")
	}
	sb.WriteString(fmt.Sprintf("  Delta    : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

func stepCrawler(wc *model.WebsiteCrawler, stepNum int, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[%d] Website Crawler  [TOOL — HTTP + ALGO]\n", stepNum))
	sb.WriteString("  Tindakan : baca halaman umum domain (/, /about, /team, /contact, dll)\n")
	if !wc.OK {
		sb.WriteString("  Hasil    : tidak ada halaman aktif yang bisa dibaca\n")
		sb.WriteString("  Hipotesis: TIDAK BERTAMBAH KUAT dari sisi konten website\n")
		sb.WriteString("  Delta    : 0\n")
		sb.WriteString("  Status   : PERLU IMPROVE — JS-heavy pages tidak terbaca; improve dengan Firecrawl atau browser tool\n")
		return sb.String()
	}
	sb.WriteString(fmt.Sprintf("  Hasil    : %d halaman aktif, %d halaman mengandung sinyal bisnis\n", wc.ActivePageCount, wc.SignalPageCount))
	delta := deltaBySource["_crawler"] + deltaBySource["website_crawler"]
	*running += delta
	if wc.SignalPageCount > 0 {
		sb.WriteString("  Hipotesis: SEMAKIN KUAT — konten website mendukung keberadaan bisnis\n")
		sb.WriteString("  Status   : OK — keyword matching sudah cukup; improve dengan role extraction (CEO/founder) dari halaman /team\n")
	} else {
		sb.WriteString("  Hipotesis: TETAP — halaman aktif tapi belum ada sinyal bisnis eksplisit\n")
		sb.WriteString("  Status   : PERLU IMPROVE — keyword list bisa diperluas; atau tambah schema.org Organization detection\n")
	}
	sb.WriteString(fmt.Sprintf("  Delta    : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

func stepSearch(result model.CompanyCheckResult, email model.EmailIntelligence, stepNum int, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[%d] Query Builder  [ALGO]  +  Search Publik  [TOOL — DDG HTML]\n", stepNum))
	primaryQuery := ""
	if len(result.SerpQueries.Queries) > 0 {
		primaryQuery = result.SerpQueries.Queries[0]
	}
	queryRationale := "prioritas: query domain/company karena custom domain"
	if email.IsFreeEmail {
		if result.Input.FullName != "" {
			queryRationale = fmt.Sprintf("prioritas: nama `%s` karena free email, cari profil publik/afiliasi bisnis", result.Input.FullName)
		} else {
			queryRationale = fmt.Sprintf("prioritas: local part `%s` karena tidak ada nama", email.Local)
		}
	}
	sb.WriteString(fmt.Sprintf("  Tindakan : susun %d query dari email/nama/brand, pilih query utama\n", len(result.SerpQueries.Queries)))
	sb.WriteString(fmt.Sprintf("  Strategi : %s\n", queryRationale))
	sb.WriteString(fmt.Sprintf("  Query    : `%s`\n", primaryQuery))

	if result.DDGSearch == nil {
		sb.WriteString("  Hasil    : search tidak dijalankan\n")
		sb.WriteString("  Delta    : 0\n")
		sb.WriteString("  Status   : PERLU IMPROVE — search tidak jalan; cek network atau provider config\n")
		return sb.String()
	}
	delta := deltaBySource["ddg_search"] + deltaBySource["free_serp_search"]
	if result.DDGSearch.OK {
		if len(result.DDGSearch.Results) == 0 {
			*running += delta
			sb.WriteString("  Hasil    : search berjalan tapi tidak ada hasil yang bisa diparse\n")
			sb.WriteString("  Hipotesis: TIDAK BERUBAH — tidak ada bukti publik yang mendukung atau menolak\n")
			sb.WriteString("  Status   : PERLU IMPROVE — DDG HTML parsing fragile dan sering diblokir ISP; improve dengan Brave/Tavily API\n")
		} else {
			*running += delta
			sb.WriteString(fmt.Sprintf("  Hasil    : %d hasil ditemukan\n", len(result.DDGSearch.Results)))
			sb.WriteString("  Hipotesis: SEDIKIT MENGUAT — ada sinyal publik yang bisa diinvestigasi lebih lanjut\n")
			sb.WriteString("  Status   : OK tapi terbatas — DDG snippet tidak bisa extract role/company secara structured; improve dengan Firecrawl scrape ke URL hasil\n")
		}
	} else {
		sb.WriteString(fmt.Sprintf("  Hasil    : GAGAL — %s\n", simplifyError(result.DDGSearch.Error)))
		sb.WriteString("  Hipotesis: TIDAK BERUBAH — search tidak bisa dijalankan\n")
		sb.WriteString("  Status   : PERLU IMPROVE — DDG HTML sering diblokir; ganti dengan Brave Search API (free tier tersedia)\n")
		delta = 0
	}
	sb.WriteString(fmt.Sprintf("  Delta    : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

func stepScraper(sc *model.ScrapeResponse, stepNum int, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[%d] Free Scraper  [TOOL — HTTP + ALGO]\n", stepNum))
	sb.WriteString("  Tindakan : baca konten teks dari URL aktif yang ditemukan\n")
	if !sc.OK {
		sb.WriteString(fmt.Sprintf("  Hasil    : GAGAL — %s\n", simplifyError(sc.Error)))
		sb.WriteString("  Hipotesis: TIDAK BERUBAH\n")
		sb.WriteString("  Delta    : 0\n")
		sb.WriteString("  Status   : PERLU IMPROVE — JS-heavy pages tidak terbaca; improve dengan Firecrawl atau Readability parser\n")
		return sb.String()
	}
	delta := deltaBySource["free_scraper"]
	*running += delta
	sb.WriteString("  Hasil    : konten berhasil dibaca\n")
	if delta > 5 {
		sb.WriteString("  Hipotesis: SEDIKIT MENGUAT — konten mengandung kata kunci bisnis\n")
		sb.WriteString("  Status   : OK tapi terbatas — keyword matching sudah jalan; improve dengan structured extraction (nama perusahaan, role, deskripsi bisnis)\n")
	} else {
		sb.WriteString("  Hipotesis: TETAP — konten terbaca tapi tidak ada sinyal bisnis tambahan\n")
		sb.WriteString("  Status   : PERLU IMPROVE — konten terbaca tapi tidak informatif; coba scrape halaman /about atau /team secara spesifik\n")
	}
	sb.WriteString(fmt.Sprintf("  Delta    : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

func scoringSummary(result model.CompanyCheckResult) string {
	var sb strings.Builder
	sb.WriteString("[SCORING] Kesimpulan Akhir\n")
	sb.WriteString(fmt.Sprintf("  Base score     : 35\n"))
	sb.WriteString(fmt.Sprintf("  Total delta    : %+d\n", result.Scoring.EvidenceDelta))
	sb.WriteString(fmt.Sprintf("  Final score    : %d/100 (%s)\n", result.ConfidenceScore, result.ConfidenceLabel))
	sb.WriteString(fmt.Sprintf("  Classification : %s\n", result.Classification))
	sb.WriteString(fmt.Sprintf("  Action         : %s\n", result.AutomationAction))
	skippedBudget := []string{}
	for _, sk := range result.ToolsSkipped {
		if sk.Reason == "disabled_waiting_budget" {
			skippedBudget = append(skippedBudget, humanToolName(sk.Tool))
		}
	}
	if len(skippedBudget) > 0 {
		sb.WriteString(fmt.Sprintf("  Bisa improve   : aktifkan %s untuk evidence lebih kuat\n", strings.Join(skippedBudget, ", ")))
	}
	return sb.String()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func initialHypothesis(email model.EmailIntelligence, input model.RegisterInput) string {
	if email.IsDisposable {
		return "kemungkinan akun suspicious/spam karena domain disposable"
	}
	if email.IsFreeEmail {
		if input.BrandName != "" {
			return fmt.Sprintf("free email tapi ada brand `%s`, jadi perlu pencarian publik untuk konfirmasi", input.BrandName)
		}
		if input.FullName != "" {
			return fmt.Sprintf("free email dengan nama `%s`, perlu pencarian publik untuk cari sinyal bisnis", input.FullName)
		}
		return "kemungkinan akun personal, tapi perlu pencarian publik untuk konfirmasi"
	}
	if email.IsRoleEmail {
		return "kemungkinan akun bisnis — custom domain dengan role mailbox adalah sinyal kuat company affiliation"
	}
	return "kemungkinan akun bisnis karena memakai custom domain"
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
