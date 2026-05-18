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
// Three layer types:
//   [Deterministik] — kode Go, rules, regex, formula. Cepat, predictable, auditable.
//   [Tools]         — network/external call. Hasilnya tergantung kondisi eksternal.
//   [AI Reasoning]  — reasoning loop (belum aktif di fase ini; direncanakan di Phase A).

func investigationSteps(result model.CompanyCheckResult) string {
	email := result.EmailIntelligence

	deltaBySource := map[string]int{}
	for _, ev := range result.Evidence {
		deltaBySource[ev.SourceType] += ev.ConfidenceDelta
	}
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

	steps = append(steps, stepEmailIntel(email, result.Input, deltaBySource, &runningScore))
	if !email.OK {
		steps = append(steps, scoringSummary(result))
		return strings.Join(steps, "\n")
	}

	steps = append(steps, stepRouting(email, result.Input))

	if result.DomainChecker != nil {
		steps = append(steps, stepDomainChecker(result.DomainChecker, email.Domain, deltaBySource, &runningScore))
	} else if !email.IsFreeEmail {
		steps = append(steps, "[3] Domain Checker  [Tools]\n  Hasil : DILEWATI — network disabled atau mode test\n  Delta : 0\n")
	}

	if result.WebsiteCrawler != nil {
		stepNum := 4
		if email.IsFreeEmail {
			stepNum = 3
		}
		steps = append(steps, stepCrawler(result.WebsiteCrawler, stepNum, deltaBySource, &runningScore))
	}

	if result.SerpQueries != nil && result.SerpQueries.OK {
		stepNum := 5
		if email.IsFreeEmail {
			stepNum = 3
		}
		steps = append(steps, stepSearch(result, email, stepNum, deltaBySource, &runningScore))
	}

	if result.FreeScraper != nil {
		stepNum := 6
		if email.IsFreeEmail {
			stepNum = 4
		}
		steps = append(steps, stepScraper(result.FreeScraper, stepNum, deltaBySource, &runningScore))
	}

	brandDelta := deltaBySource["registration_input"]
	if brandDelta != 0 && result.Input.BrandName != "" {
		runningScore += brandDelta
		steps = append(steps, fmt.Sprintf(
			"[+] Register Input — Brand Name  [Deterministik]\n  Algoritma : baca field brand_name dari data register\n  Hasil     : brand `%s` tersedia → sinyal bisnis dari data register\n  Artinya   : ada indikasi bisnis dari input, tapi belum cukup tanpa konfirmasi publik\n  Delta     : %+d → score sementara %d/100\n",
			result.Input.BrandName, brandDelta, clamp(runningScore),
		))
	}

	steps = append(steps, aiReasoningBlock(result, email))
	steps = append(steps, scoringSummary(result))
	return strings.Join(steps, "\n")
}

func stepEmailIntel(email model.EmailIntelligence, input model.RegisterInput, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString("[1] Email Intelligence  [Deterministik]\n")
	if !email.OK {
		sb.WriteString(fmt.Sprintf("  Algoritma : validasi format + klasifikasi domain untuk `%s`\n", input.Email))
		sb.WriteString(fmt.Sprintf("  Hasil     : TIDAK VALID — %s\n", email.Error))
		sb.WriteString("  Artinya   : input tidak bisa diproses lebih lanjut, investigasi dihentikan\n")
		sb.WriteString("  Delta     : -30 (invalid input)\n")
		return sb.String()
	}
	domainType := "custom domain"
	if email.IsFreeEmail {
		domainType = "free email provider"
	}
	if email.IsDisposable {
		domainType = "disposable email (suspicious)"
	}
	sb.WriteString(fmt.Sprintf("  Algoritma : parse email → split local/domain → cek free domain list → cek disposable hints → cek role mailbox\n"))
	sb.WriteString(fmt.Sprintf("  Hasil     : local=`%s`, domain=`%s`, tipe=%s", email.Local, email.Domain, domainType))
	if email.IsRoleEmail {
		sb.WriteString(fmt.Sprintf(", role mailbox=ya (local `%s` adalah alamat bisnis)", email.Local))
	}
	sb.WriteString("\n")
	delta := deltaBySource["email_domain"] + deltaBySource["email_local_part"] + deltaBySource["input_validation"]
	*running += delta
	sb.WriteString(fmt.Sprintf("  Artinya   : %s\n", initialHypothesis(email, input)))
	sb.WriteString(fmt.Sprintf("  Delta     : %+d → score sementara %d/100\n", delta, clamp(*running)))
	if email.IsFreeEmail {
		sb.WriteString("  Evaluasi  : OK — free domain list cukup luas; bisa diperluas dengan disposable DB lebih lengkap\n")
	} else {
		sb.WriteString("  Evaluasi  : OK — custom domain detection deterministik dan reliable\n")
	}
	return sb.String()
}

func stepRouting(email model.EmailIntelligence, input model.RegisterInput) string {
	var sb strings.Builder
	sb.WriteString("[2] Routing Decision  [Deterministik]\n")
	sb.WriteString("  Algoritma : tentukan jalur investigasi berdasarkan tipe email\n")
	if email.IsFreeEmail {
		sb.WriteString("  Hasil     : free email → domain checker dan website crawler DILEWATI\n")
		sb.WriteString("  Artinya   : tidak ada company domain yang bisa dicek; investigasi harus lewat pencarian publik\n")
		nameHint := email.Local
		if input.FullName != "" {
			nameHint = input.FullName
		}
		sb.WriteString(fmt.Sprintf("  Jalur     : pencarian publik menggunakan sinyal `%s`\n", nameHint))
		sb.WriteString("  Evaluasi  : OK — routing sudah benar; bisa diperkuat dengan brand_name sebagai sinyal routing tambahan\n")
	} else {
		sb.WriteString("  Hasil     : custom domain → lanjut ke domain checker dan website crawler\n")
		sb.WriteString("  Artinya   : ada company domain yang bisa diverifikasi secara langsung\n")
		sb.WriteString("  Jalur     : cek DNS, MX, website, dan halaman-halaman bisnis\n")
		sb.WriteString("  Evaluasi  : OK — routing deterministik dan sudah sesuai\n")
	}
	sb.WriteString("  Delta     : 0 (routing tidak mengubah score)\n")
	return sb.String()
}

func stepDomainChecker(dc *model.DomainCheck, domain string, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString("[3] Domain Checker  [Tools — DNS + HTTP]\n")
	sb.WriteString(fmt.Sprintf("  Tool      : DNS resolver + HTTP probe ke `%s`\n", domain))
	if !dc.OK {
		sb.WriteString(fmt.Sprintf("  Hasil     : GAGAL — %s\n", simplifyError(dc.Error)))
		sb.WriteString("  Artinya   : tidak bisa konfirmasi atau tolak hipotesis company dari domain ini\n")
		sb.WriteString("  Delta     : 0\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — tambah retry policy dan HTTP fallback jika HTTPS gagal\n")
		return sb.String()
	}
	websiteDesc := "tidak aktif"
	if dc.WebsiteActive && dc.Website != nil && dc.Website.Title != "" {
		websiteDesc = fmt.Sprintf("aktif, title: `%s`", dc.Website.Title)
	} else if dc.WebsiteActive {
		websiteDesc = "aktif"
	}
	sb.WriteString(fmt.Sprintf("  Hasil     : MX=%s, website=%s\n", dc.MXStatus, websiteDesc))
	delta := deltaBySource["_domain"] + deltaBySource["dns_mx"] + deltaBySource["dns_address"] + deltaBySource["company_website"] + deltaBySource["domain_validation"]
	*running += delta
	if dc.WebsiteActive {
		sb.WriteString("  Artinya   : domain punya infrastruktur email dan website aktif → hipotesis company affiliation MENGUAT\n")
		sb.WriteString("  Evaluasi  : OK — DNS + HTTP probe cukup untuk MVP; bisa ditingkatkan dengan schema.org extraction\n")
	} else {
		sb.WriteString("  Artinya   : domain ada tapi website belum terkonfirmasi aktif → hipotesis TETAP, belum bisa dikonfirmasi\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — website tidak aktif bisa false negative; coba HTTP fallback atau retry\n")
	}
	sb.WriteString(fmt.Sprintf("  Delta     : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

func stepCrawler(wc *model.WebsiteCrawler, stepNum int, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[%d] Website Crawler  [Tools — HTTP + Deterministik]\n", stepNum))
	sb.WriteString("  Tool      : HTTP fetch ke halaman umum (/, /about, /team, /contact, dll)\n")
	sb.WriteString("  Algoritma : keyword matching untuk deteksi sinyal bisnis di konten halaman\n")
	if !wc.OK {
		sb.WriteString("  Hasil     : tidak ada halaman aktif yang bisa dibaca\n")
		sb.WriteString("  Artinya   : tidak ada konten website yang bisa dijadikan evidence → hipotesis TIDAK BERTAMBAH KUAT\n")
		sb.WriteString("  Delta     : 0\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — JS-heavy pages tidak terbaca; butuh Firecrawl atau browser tool\n")
		return sb.String()
	}
	sb.WriteString(fmt.Sprintf("  Hasil     : %d halaman aktif, %d halaman mengandung sinyal bisnis\n", wc.ActivePageCount, wc.SignalPageCount))
	delta := deltaBySource["_crawler"] + deltaBySource["website_crawler"]
	*running += delta
	if wc.SignalPageCount > 0 {
		sb.WriteString("  Artinya   : konten website mendukung keberadaan bisnis → hipotesis SEMAKIN KUAT\n")
		sb.WriteString("  Evaluasi  : OK — keyword matching cukup; bisa ditingkatkan dengan role extraction dari halaman /team\n")
	} else {
		sb.WriteString("  Artinya   : halaman aktif tapi tidak ada sinyal bisnis eksplisit → hipotesis TETAP\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — keyword list bisa diperluas; tambah schema.org Organization detection\n")
	}
	sb.WriteString(fmt.Sprintf("  Delta     : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

func stepSearch(result model.CompanyCheckResult, email model.EmailIntelligence, stepNum int, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[%d] Query Builder  [Deterministik]  +  Search Publik  [Tools — DDG HTML]\n", stepNum))

	primaryQuery := ""
	if len(result.SerpQueries.Queries) > 0 {
		primaryQuery = result.SerpQueries.Queries[0]
	}
	queryRationale := "prioritas query domain/company karena custom domain"
	if email.IsFreeEmail {
		if result.Input.FullName != "" {
			queryRationale = fmt.Sprintf("prioritas nama `%s` karena free email, cari profil publik/afiliasi bisnis", result.Input.FullName)
		} else {
			queryRationale = fmt.Sprintf("prioritas local part `%s` karena tidak ada nama", email.Local)
		}
	}
	sb.WriteString(fmt.Sprintf("  Algoritma : susun %d query dari email/nama/brand berdasarkan tipe email\n", len(result.SerpQueries.Queries)))
	sb.WriteString(fmt.Sprintf("  Strategi  : %s\n", queryRationale))
	sb.WriteString(fmt.Sprintf("  Query     : `%s`\n", primaryQuery))

	if result.DDGSearch == nil {
		sb.WriteString("  Hasil     : search tidak dijalankan\n")
		sb.WriteString("  Artinya   : tidak ada data publik yang bisa dikumpulkan → hipotesis tidak berubah\n")
		sb.WriteString("  Delta     : 0\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — search tidak jalan; cek network atau provider config\n")
		return sb.String()
	}
	delta := deltaBySource["ddg_search"] + deltaBySource["free_serp_search"]
	if result.DDGSearch.OK {
		if len(result.DDGSearch.Results) == 0 {
			*running += delta
			sb.WriteString("  Hasil     : search berjalan tapi tidak ada hasil yang bisa diparse\n")
			sb.WriteString("  Artinya   : tidak ada bukti publik yang mendukung atau menolak hipotesis → confidence tidak naik\n")
			sb.WriteString("  Evaluasi  : PERLU IMPROVE — DDG HTML parsing fragile dan sering diblokir ISP; ganti dengan Brave Search API\n")
		} else {
			*running += delta
			sb.WriteString(fmt.Sprintf("  Hasil     : %d hasil ditemukan\n", len(result.DDGSearch.Results)))
			sb.WriteString("  Artinya   : ada sinyal publik yang mendukung investigasi → hipotesis SEDIKIT MENGUAT\n")
			sb.WriteString("  Evaluasi  : OK tapi terbatas — DDG snippet tidak bisa extract role/company secara structured; butuh Firecrawl untuk scrape URL hasil\n")
		}
	} else {
		sb.WriteString(fmt.Sprintf("  Hasil     : GAGAL — %s\n", simplifyError(result.DDGSearch.Error)))
		sb.WriteString("  Artinya   : search tidak bisa dijalankan → hipotesis tidak berubah\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — DDG HTML sering diblokir; ganti dengan Brave Search API (free tier tersedia)\n")
		delta = 0
	}
	sb.WriteString(fmt.Sprintf("  Delta     : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

func stepScraper(sc *model.ScrapeResponse, stepNum int, deltaBySource map[string]int, running *int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[%d] Free Scraper  [Tools — HTTP + Deterministik]\n", stepNum))
	sb.WriteString("  Tool      : HTTP fetch ke URL aktif yang ditemukan\n")
	sb.WriteString("  Algoritma : strip HTML → extract plain text → keyword matching\n")
	if !sc.OK {
		sb.WriteString(fmt.Sprintf("  Hasil     : GAGAL — %s\n", simplifyError(sc.Error)))
		sb.WriteString("  Artinya   : konten tidak bisa dibaca → tidak ada evidence tambahan\n")
		sb.WriteString("  Delta     : 0\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — JS-heavy pages tidak terbaca; butuh Firecrawl atau Readability parser\n")
		return sb.String()
	}
	delta := deltaBySource["free_scraper"]
	*running += delta
	sb.WriteString("  Hasil     : konten berhasil dibaca\n")
	if delta > 5 {
		sb.WriteString("  Artinya   : konten mengandung kata kunci bisnis → hipotesis SEDIKIT MENGUAT\n")
		sb.WriteString("  Evaluasi  : OK tapi terbatas — keyword matching jalan; butuh structured extraction untuk nama perusahaan dan role\n")
	} else {
		sb.WriteString("  Artinya   : konten terbaca tapi tidak ada sinyal bisnis → hipotesis TETAP\n")
		sb.WriteString("  Evaluasi  : PERLU IMPROVE — coba scrape halaman /about atau /team secara spesifik\n")
	}
	sb.WriteString(fmt.Sprintf("  Delta     : %+d → score sementara %d/100\n", delta, clamp(*running)))
	return sb.String()
}

// aiReasoningBlock menampilkan apa yang seharusnya dilakukan AI Reasoning
// berdasarkan profil input dan evidence yang sudah terkumpul — termasuk
// tools yang belum aktif dan kenapa investigasi bisa lebih dalam.
func aiReasoningBlock(result model.CompanyCheckResult, email model.EmailIntelligence) string {
	var sb strings.Builder
	sb.WriteString("[AI Reasoning]  ← belum aktif di fase ini; direncanakan di Phase A\n")

	// Apa yang AI seharusnya lakukan berdasarkan profil ini
	sb.WriteString("  Profil    : ")
	if email.IsFreeEmail {
		if result.Input.BrandName != "" {
			sb.WriteString(fmt.Sprintf("free email + brand `%s` → kemungkinan ada bisnis yang bisa ditelusuri\n", result.Input.BrandName))
		} else if result.Input.FullName != "" {
			sb.WriteString(fmt.Sprintf("free email + nama `%s` → perlu cari profil publik dan afiliasi bisnis\n", result.Input.FullName))
		} else {
			sb.WriteString(fmt.Sprintf("free email, local part `%s` → perlu analisis apakah ini brand/toko/persona publik\n", email.Local))
		}
	} else {
		sb.WriteString(fmt.Sprintf("custom domain `%s` → perlu enrichment company profile dan social footprint\n", email.Domain))
	}

	// Reasoning yang seharusnya terjadi
	sb.WriteString("  Reasoning : dengan profil ini, AI seharusnya:\n")
	if email.IsFreeEmail {
		localLower := strings.ToLower(email.Local)
		if looksLikeBrand(localLower) {
			sb.WriteString(fmt.Sprintf("    1. Deteksi bahwa `%s` kemungkinan nama brand/toko, bukan nama orang\n", email.Local))
			sb.WriteString(fmt.Sprintf("    2. Pivot query ke: `%s` tokopedia OR shopee OR instagram OR website\n", email.Local))
			sb.WriteString("    3. Jika nemu profil/toko → fetch halaman → extract nama owner dan domain\n")
			sb.WriteString("    4. Cross-check domain kandidat dengan domain checker\n")
		} else if result.Input.FullName != "" {
			sb.WriteString(fmt.Sprintf("    1. Search `%s` di LinkedIn, Instagram, GitHub, Product Hunt\n", result.Input.FullName))
			sb.WriteString("    2. Baca snippet hasil → cari kata kunci founder/owner/CEO/direktur\n")
			sb.WriteString("    3. Jika nemu company mention → cek domain company tersebut\n")
			sb.WriteString("    4. Cross-check: apakah nama di website match dengan full_name?\n")
		} else {
			sb.WriteString(fmt.Sprintf("    1. Analisis local part `%s` → apakah ini nama orang, brand, atau username?\n", email.Local))
			sb.WriteString("    2. Search di platform publik berdasarkan analisis tersebut\n")
			sb.WriteString("    3. Iterasi dari temuan → cari konfirmasi bisnis\n")
		}
	} else {
		sb.WriteString(fmt.Sprintf("    1. Extract social links dari homepage `%s`\n", email.Domain))
		sb.WriteString("    2. Cari LinkedIn company page, Instagram, X, Facebook via SERP\n")
		sb.WriteString("    3. Cari nama founder/CEO dari halaman /about atau /team\n")
		sb.WriteString("    4. Cross-check: apakah full_name muncul di website sebagai role eksplisit?\n")
	}

	// Tools yang dibutuhkan tapi belum aktif
	missingTools := []string{}
	for _, sk := range result.ToolsSkipped {
		if sk.Reason == "disabled_waiting_budget" {
			missingTools = append(missingTools, fmt.Sprintf("`%s`", humanToolName(sk.Tool)))
		}
	}
	if len(missingTools) > 0 {
		sb.WriteString(fmt.Sprintf("  Butuh     : %s — belum aktif karena menunggu budget/API key\n", strings.Join(missingTools, ", ")))
		sb.WriteString("  Dampak    : tanpa tools ini, AI tidak bisa melakukan iterasi evidence gathering yang lebih dalam\n")
	}

	// Apa yang bisa dilakukan sekarang vs nanti
	sb.WriteString("  Sekarang  : investigasi berhenti di sini karena flow masih deterministik penuh\n")
	sb.WriteString("  Phase A   : AI akan mengambil alih dari titik ini, melakukan reasoning loop sampai confidence cukup atau budget habis\n")

	return sb.String()
}

// looksLikeBrand mendeteksi apakah local part email kemungkinan adalah nama brand/toko
// bukan nama orang — berdasarkan pola kata yang umum di nama bisnis.
func looksLikeBrand(local string) bool {
	brandKeywords := []string{
		"store", "shop", "toko", "mart", "market", "studio", "design",
		"creative", "digital", "tech", "media", "agency", "official",
		"brand", "fashion", "beauty", "food", "cafe", "kitchen",
		"collection", "boutique", "craft", "art", "wear", "style",
	}
	for _, kw := range brandKeywords {
		if strings.Contains(local, kw) {
			return true
		}
	}
	return false
}

func scoringSummary(result model.CompanyCheckResult) string {
	var sb strings.Builder
	sb.WriteString("[Deterministik] Scoring Engine — Kesimpulan Akhir\n")
	sb.WriteString("  Algoritma : base_score + sum(evidence_delta), clamp 0–100\n")
	sb.WriteString(fmt.Sprintf("  Base score : 35\n"))
	sb.WriteString(fmt.Sprintf("  Total delta: %+d\n", result.Scoring.EvidenceDelta))
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
