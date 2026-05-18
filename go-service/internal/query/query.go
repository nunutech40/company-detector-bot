package query

import (
	"strings"

	"company-detector/go-service/internal/model"
)

type Input struct {
	Email                string
	Domain               string
	Local                string
	FullName             string
	BrandName            string
	IncludeDomainQueries bool
}

func Build(input Input) model.QueryPlan {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	domain := strings.ToLower(strings.TrimSpace(input.Domain))
	if domain == "" && strings.Contains(email, "@") {
		domain = strings.SplitN(email, "@", 2)[1]
	}
	local := strings.TrimSpace(input.Local)
	if local == "" && strings.Contains(email, "@") {
		local = strings.SplitN(email, "@", 2)[0]
	}
	fullName := strings.TrimSpace(input.FullName)
	brandName := strings.TrimSpace(input.BrandName)
	domainOrBrand := domain
	if brandName != "" {
		domainOrBrand = brandName
	}

	queries := []string{}
	if domain != "" && input.IncludeDomainQueries {
		root := strings.Split(domain, ".")[0]
		queries = appendUnique(queries,
			`"`+domain+`" company`,
			`site:`+domain+` about OR team OR contact`,
			`"`+root+`" startup OR company OR platform`,
			`"`+domain+`" LinkedIn`,
		)
	}
	if brandName != "" {
		queries = appendUnique(queries,
			`"`+brandName+`" company OR business OR official`,
			`"`+brandName+`" LinkedIn OR Instagram OR marketplace`,
		)
	}
	if fullName != "" {
		if domainOrBrand != "" {
			queries = appendUnique(queries, `"`+fullName+`" "`+domainOrBrand+`"`)
		}
		queries = appendUnique(queries, `"`+fullName+`" founder OR owner OR company OR LinkedIn`)
	}
	if local != "" {
		queries = appendUnique(queries, `"`+local+`" GitHub OR Product Hunt OR LinkedIn`)
	}

	return model.QueryPlan{
		OK: true, Email: emptyToOmit(email), Domain: emptyToOmit(domain),
		IncludeDomainQueries: input.IncludeDomainQueries,
		FullName:             emptyToOmit(fullName), BrandName: emptyToOmit(brandName), Queries: queries,
	}
}

func appendUnique(items []string, values ...string) []string {
	seen := map[string]bool{}
	for _, item := range items {
		seen[item] = true
	}
	for _, value := range values {
		if strings.TrimSpace(value) == "" || seen[value] {
			continue
		}
		items = append(items, value)
		seen[value] = true
	}
	return items
}

func emptyToOmit(value string) string {
	return strings.TrimSpace(value)
}
