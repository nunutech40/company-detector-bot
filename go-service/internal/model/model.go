package model

type Classification string

const (
	ClassificationPossibleCompany Classification = "possible_company_affiliated"
	ClassificationUnknown         Classification = "unknown_needs_more_evidence"
	ClassificationPersonal        Classification = "likely_personal_email"
	ClassificationSuspicious      Classification = "suspicious_or_invalid"
)

type AutomationAction string

const (
	ActionRouteCompany AutomationAction = "route_company_associated"
	ActionContinue     AutomationAction = "continue_as_personal_or_unknown"
	ActionRiskReview   AutomationAction = "risk_or_format_review"
	ActionStoreUnknown AutomationAction = "store_unknown_retry_later"
)

type RegisterInput struct {
	Email         string   `json:"email"`
	FullName      string   `json:"full_name,omitempty"`
	NoHP          string   `json:"no_hp,omitempty"`
	PhoneMasked   string   `json:"phone_masked,omitempty"`
	BrandName     string   `json:"brand_name,omitempty"`
	IgnoredFields []string `json:"ignored_fields"`
}

type EvidenceItem struct {
	SourceType      string      `json:"source_type"`
	SourceURL       string      `json:"source_url,omitempty"`
	ToolCall        string      `json:"tool_call,omitempty"` // e.g. "web_fetch(https://...)" — required for ai_* source types
	Reliability     string      `json:"reliability"`
	Claim           string      `json:"claim"`
	Value           interface{} `json:"value,omitempty"`
	ConfidenceDelta int         `json:"confidence_delta"`
	Verified        bool        `json:"verified"` // true only if source_url or tool_call is present
}

type ToolSkipped struct {
	Tool   string `json:"tool"`
	Reason string `json:"reason"`
}

type ToolError struct {
	Tool  string `json:"tool"`
	Error string `json:"error"`
}

type EmailIntelligence struct {
	OK               bool           `json:"ok"`
	Input            string         `json:"input,omitempty"`
	Error            string         `json:"error,omitempty"`
	Email            string         `json:"email,omitempty"`
	Local            string         `json:"local,omitempty"`
	Domain           string         `json:"domain,omitempty"`
	TLD              string         `json:"tld,omitempty"`
	IsFreeEmail      bool           `json:"is_free_email"`
	IsDisposable     bool           `json:"is_disposable"`
	IsRoleEmail      bool           `json:"is_role_email"`
	Tags             []string       `json:"tags,omitempty"`
	InitialSuspicion string         `json:"initial_suspicion,omitempty"`
	Evidence         []EvidenceItem `json:"evidence"`
}

type WebsiteProbe struct {
	OK          bool   `json:"ok"`
	URL         string `json:"url"`
	FinalURL    string `json:"final_url,omitempty"`
	Status      int    `json:"status,omitempty"`
	Active      bool   `json:"active"`
	ContentType string `json:"content_type,omitempty"`
	Title       string `json:"title,omitempty"`
	BodySample  string `json:"body_sample,omitempty"`
	Error       string `json:"error,omitempty"`
	LatencyMS   int64  `json:"latency_ms"`
}

type DomainCheck struct {
	OK                bool           `json:"ok"`
	Domain            string         `json:"domain,omitempty"`
	Error             string         `json:"error,omitempty"`
	MXStatus          string         `json:"mx_status,omitempty"`
	MXRecords         []string       `json:"mx_records"`
	HasAddressRecords bool           `json:"has_address_records"`
	ARecords          []string       `json:"a_records"`
	AAAARecords       []string       `json:"aaaa_records"`
	TXTRecordCount    int            `json:"txt_record_count"`
	WebsiteActive     bool           `json:"website_active"`
	Website           *WebsiteProbe  `json:"website"`
	Evidence          []EvidenceItem `json:"evidence"`
}

type CrawlPage struct {
	OK              bool     `json:"ok"`
	URL             string   `json:"url"`
	FinalURL        string   `json:"final_url,omitempty"`
	Path            string   `json:"path"`
	Status          int      `json:"status,omitempty"`
	Active          bool     `json:"active"`
	ContentType     string   `json:"content_type,omitempty"`
	Title           string   `json:"title,omitempty"`
	MetaDescription string   `json:"meta_description,omitempty"`
	Signals         []string `json:"signals,omitempty"`
	TextSample      string   `json:"text_sample,omitempty"`
	Error           string   `json:"error,omitempty"`
	LatencyMS       int64    `json:"latency_ms"`
}

type WebsiteCrawler struct {
	OK              bool           `json:"ok"`
	Domain          string         `json:"domain,omitempty"`
	Error           string         `json:"error,omitempty"`
	CandidatePaths  []string       `json:"candidate_paths"`
	ActivePageCount int            `json:"active_page_count"`
	SignalPageCount int            `json:"signal_page_count"`
	Pages           []CrawlPage    `json:"pages"`
	Evidence        []EvidenceItem `json:"evidence"`
}

type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet,omitempty"`
}

type SearchResponse struct {
	OK       bool           `json:"ok"`
	Error    string         `json:"error,omitempty"`
	Query    string         `json:"query"`
	Provider string         `json:"provider,omitempty"` // which provider actually returned results
	Results  []SearchResult `json:"results"`
}

type ScrapeResponse struct {
	OK             bool   `json:"ok"`
	URL            string `json:"url"`
	FinalURL       string `json:"final_url,omitempty"`
	Error          string `json:"error,omitempty"`
	ContentSnippet string `json:"content_snippet,omitempty"`
	LatencyMS      int64  `json:"latency_ms"`
}

type QueryPlan struct {
	OK                   bool     `json:"ok"`
	Email                string   `json:"email,omitempty"`
	Domain               string   `json:"domain,omitempty"`
	IncludeDomainQueries bool     `json:"include_domain_queries"`
	FullName             string   `json:"full_name,omitempty"`
	BrandName            string   `json:"brand_name,omitempty"`
	Queries              []string `json:"queries"`
}

type ScoreBreakdown struct {
	BaseScore        int `json:"base_score"`
	EvidenceDelta    int `json:"evidence_delta"`
	FinalScore       int `json:"final_score"`
	RejectedEvidence int `json:"rejected_evidence,omitempty"` // AI evidence rejected due to missing source
}

type ScoreResult struct {
	OK                bool             `json:"ok"`
	Classification    Classification   `json:"classification"`
	CompanyDetected   bool             `json:"company_detected"`
	ConfidenceScore   int              `json:"confidence_score"`
	ConfidenceLabel   string           `json:"confidence_label"`
	AutomationAction  AutomationAction `json:"automation_action"`
	OwnerClaimAllowed bool             `json:"owner_claim_allowed"`
	ScoreBreakdown    ScoreBreakdown   `json:"score_breakdown"`
}

type CompanyCheckResult struct {
	OK                bool              `json:"ok"`
	JobType           string            `json:"job_type"`
	ObservedAt        string            `json:"observed_at"`
	Input             RegisterInput     `json:"input"`
	Classification    Classification    `json:"classification"`
	CompanyDetected   bool              `json:"company_detected"`
	ConfidenceScore   int               `json:"confidence_score"`
	ConfidenceLabel   string            `json:"confidence_label"`
	AutomationAction  AutomationAction  `json:"automation_action"`
	OwnerClaimAllowed bool              `json:"owner_claim_allowed"`
	Scoring           ScoreBreakdown    `json:"scoring"`
	EmailIntelligence EmailIntelligence `json:"email_intelligence"`
	DomainChecker     *DomainCheck      `json:"domain_checker"`
	WebsiteCrawler    *WebsiteCrawler   `json:"website_crawler"`
	DDGSearch         *SearchResponse   `json:"ddg_search"`
	FreeScraper       *ScrapeResponse   `json:"free_scraper"`
	SerpQueries       *QueryPlan        `json:"serp_queries"`
	ToolsUsed         []string          `json:"tools_used"`
	ToolsSkipped      []ToolSkipped     `json:"tools_skipped"`
	ToolErrors        []ToolError       `json:"tool_errors"`
	Evidence          []EvidenceItem    `json:"evidence"`
	Summary           string            `json:"summary"`
	Recommendation    string            `json:"recommendation"`
	TelegramReport    string            `json:"telegram_report"`
	Storage           interface{}       `json:"storage,omitempty"`
	Delivery          interface{}       `json:"delivery,omitempty"`
}
