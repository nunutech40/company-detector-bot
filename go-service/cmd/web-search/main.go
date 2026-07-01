package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"company-detector/go-service/internal/search"
)

func main() {
	query := flag.String("query", "", "public-web search query")
	limit := flag.Int("limit", 5, "maximum results")
	timeout := flag.Duration("timeout", 15*time.Second, "overall search timeout")
	flag.Parse()
	if *query == "" {
		fmt.Fprintln(os.Stderr, "web-search: --query is required")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	result := search.Search(ctx, *query, search.Options{Limit: *limit, Timeout: *timeout})
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "web-search:", err)
		os.Exit(1)
	}
	fmt.Println(string(data))
	if !result.OK {
		os.Exit(1)
	}
}
