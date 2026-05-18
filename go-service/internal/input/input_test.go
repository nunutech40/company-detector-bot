package input

import "testing"

func TestNormalizeFullPackageAndIgnoredUsername(t *testing.T) {
	got := Normalize(map[string]string{
		"email":      " Person@Gmail.com ",
		"full_name":  " Person Name ",
		"no_hp":      "0812-3456-789",
		"brand_name": "Acme Studio",
		"username":   "person@gmail.com",
	})
	if got.Email != "person@gmail.com" || got.FullName != "Person Name" || got.BrandName != "Acme Studio" {
		t.Fatalf("unexpected normalized input: %#v", got)
	}
	if got.NoHP != "08123456789" || got.PhoneMasked != "*******6789" {
		t.Fatalf("unexpected phone normalization: %#v", got)
	}
	if len(got.IgnoredFields) != 1 || got.IgnoredFields[0] != "username" {
		t.Fatalf("expected ignored username, got %#v", got.IgnoredFields)
	}
}
