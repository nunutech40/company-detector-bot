package emailintel

import (
	"regexp"
	"strings"

	"company-detector/go-service/internal/model"
)

var freeDomains = map[string]bool{
	"gmail.com": true, "googlemail.com": true, "yahoo.com": true, "ymail.com": true,
	"rocketmail.com": true, "outlook.com": true, "hotmail.com": true, "live.com": true,
	"msn.com": true, "icloud.com": true, "me.com": true, "mac.com": true,
	"proton.me": true, "protonmail.com": true, "aol.com": true, "zoho.com": true,
	"mail.com": true, "gmx.com": true,
}

var roleLocals = map[string]bool{
	"admin": true, "billing": true, "contact": true, "cs": true, "founder": true,
	"hello": true, "help": true, "hr": true, "info": true, "marketing": true,
	"office": true, "sales": true, "security": true, "support": true, "team": true,
}

var disposableHints = []string{
	"mailinator", "tempmail", "10minutemail", "guerrillamail", "yopmail",
	"trashmail", "getnada", "sharklasers",
}

var emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func Analyze(value string) model.EmailIntelligence {
	email := strings.ToLower(strings.TrimSpace(value))
	if !emailRegex.MatchString(email) {
		return model.EmailIntelligence{
			OK:    false,
			Input: value,
			Error: "invalid_email",
			Evidence: []model.EvidenceItem{{
				SourceType:      "input_validation",
				Reliability:     "high",
				Claim:           "Input is not a valid email address.",
				Value:           value,
				ConfidenceDelta: -30,
			}},
		}
	}

	parts := strings.SplitN(email, "@", 2)
	local, domain := parts[0], parts[1]
	tldParts := strings.Split(domain, ".")
	tld := tldParts[len(tldParts)-1]
	isFree := freeDomains[domain]
	isDisposable := false
	for _, hint := range disposableHints {
		if strings.Contains(domain, hint) {
			isDisposable = true
			break
		}
	}
	isRole := roleLocals[local]

	initial := "possible_company_domain"
	if isDisposable {
		initial = "suspicious_or_invalid"
	} else if isFree {
		initial = "free_email_needs_more_evidence"
	}

	tags := []string{}
	if isFree {
		tags = append(tags, "free_email_provider")
	}
	if isDisposable {
		tags = append(tags, "disposable_email_hint")
	}
	if isRole {
		tags = append(tags, "role_email")
	}
	if !isFree && !isDisposable {
		tags = append(tags, "custom_domain")
	}
	if tld != "" {
		tags = append(tags, "tld_"+tld)
	}

	claim := "Email uses a custom domain, not a known free provider."
	delta := 30
	if isFree {
		claim = "Email uses a known free/personal provider."
		delta = -30
	}
	evidence := []model.EvidenceItem{{
		SourceType:      "email_domain",
		Reliability:     "high",
		Claim:           claim,
		Value:           domain,
		ConfidenceDelta: delta,
	}}
	if isRole {
		evidence = append(evidence, model.EvidenceItem{
			SourceType:      "email_local_part",
			Reliability:     "medium",
			Claim:           "Email local part is a role/contact mailbox.",
			Value:           local,
			ConfidenceDelta: 10,
		})
	}
	if isDisposable {
		evidence = append(evidence, model.EvidenceItem{
			SourceType:      "email_domain",
			Reliability:     "high",
			Claim:           "Domain matches disposable email hints.",
			Value:           domain,
			ConfidenceDelta: -40,
		})
	}

	return model.EmailIntelligence{
		OK: true, Email: email, Local: local, Domain: domain, TLD: tld,
		IsFreeEmail: isFree, IsDisposable: isDisposable, IsRoleEmail: isRole,
		Tags: tags, InitialSuspicion: initial, Evidence: evidence,
	}
}
