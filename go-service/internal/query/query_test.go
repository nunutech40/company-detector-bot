package query

import "testing"

func TestFreeEmailWithBrandSkipsFreeDomainQueries(t *testing.T) {
	got := Build(Input{Email: "person@gmail.com", Local: "person", FullName: "Person Name", BrandName: "Acme Studio", IncludeDomainQueries: false})
	if len(got.Queries) == 0 || got.Queries[0] != `"Acme Studio" company OR business OR official` {
		t.Fatalf("unexpected query order: %#v", got.Queries)
	}
	for _, item := range got.Queries {
		if item == `"gmail.com" company` {
			t.Fatalf("free email generated domain query: %#v", got.Queries)
		}
	}
}

func TestCustomDomainQueries(t *testing.T) {
	got := Build(Input{Email: "contact@komerce.id", Domain: "komerce.id", Local: "contact", IncludeDomainQueries: true})
	if got.Queries[0] != `"komerce.id" company` {
		t.Fatalf("unexpected first query: %#v", got.Queries)
	}
}
