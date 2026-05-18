package input

import (
	"strings"
	"unicode"

	"company-detector/go-service/internal/model"
)

func CleanString(value string) string {
	return strings.TrimSpace(value)
}

func NormalizePhone(value string) string {
	var builder strings.Builder
	for _, char := range strings.TrimSpace(value) {
		if unicode.IsDigit(char) || char == '+' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func MaskPhone(value string) string {
	phone := NormalizePhone(value)
	if phone == "" {
		return ""
	}
	if len(phone) <= 4 {
		return "****"
	}
	return strings.Repeat("*", len(phone)-4) + phone[len(phone)-4:]
}

func Normalize(values map[string]string) model.RegisterInput {
	read := func(keys ...string) string {
		for _, key := range keys {
			if value := CleanString(values[key]); value != "" {
				return value
			}
		}
		return ""
	}

	email := strings.ToLower(read("email", "Email", "mail"))
	noHP := NormalizePhone(read("no_hp", "noHp", "phone", "hp"))
	ignored := []string{}
	for _, key := range []string{"username", "signup_source", "referrer", "country", "ip_country"} {
		if CleanString(values[key]) != "" {
			ignored = append(ignored, key)
		}
	}

	return model.RegisterInput{
		Email:         email,
		FullName:      read("full_name", "fullName", "name", "nama"),
		NoHP:          noHP,
		PhoneMasked:   MaskPhone(noHP),
		BrandName:     read("brand_name", "brandName", "company_field", "company", "brand"),
		IgnoredFields: ignored,
	}
}
