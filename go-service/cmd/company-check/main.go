package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"company-detector/go-service/internal/evidence"
	"company-detector/go-service/internal/input"
	"company-detector/go-service/internal/model"
	"company-detector/go-service/internal/orchestrator"
	"company-detector/go-service/internal/slack"
)

func main() {
	var (
		email       = flag.String("email", "", "registration email")
		fullName    = flag.String("full-name", "", "full name from registration")
		noHP        = flag.String("no-hp", "", "phone number from registration")
		brandName   = flag.String("brand-name", "", "brand/company field from registration")
		inputJSON   = flag.String("input-json", "", "JSON object with email, full_name, no_hp, brand_name")
		outputJSON  = flag.Bool("json", false, "print JSON result")
		save        = flag.Bool("save", false, "save evidence/report files")
		baseDir     = flag.String("base-dir", "..", "base directory for evidence and reports")
		sendSlack   = flag.Bool("send-slack", false, "send Slack alert when automation action routes company")
		skipNetwork = flag.Bool("skip-network", false, "skip DNS/search/scrape network tools")
		timeout     = flag.Duration("timeout", 30*time.Second, "overall run timeout")
	)
	flag.Parse()

	raw := map[string]string{
		"email":      *email,
		"full_name":  *fullName,
		"no_hp":      *noHP,
		"brand_name": *brandName,
	}
	if *inputJSON != "" {
		var parsed map[string]string
		if err := json.Unmarshal([]byte(*inputJSON), &parsed); err != nil {
			exitError("invalid input-json: " + err.Error())
		}
		for key, value := range parsed {
			raw[key] = value
		}
	}
	if raw["email"] == "" && flag.NArg() > 0 {
		raw["email"] = flag.Arg(0)
	}

	normalized := input.Normalize(raw)
	if normalized.Email == "" {
		exitError("email is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	result := orchestrator.Run(ctx, normalized, orchestrator.Options{SkipNetwork: *skipNetwork})

	if *save {
		paths, err := evidence.Store(result, evidence.Options{BaseDir: *baseDir})
		if err != nil {
			exitError("save failed: " + err.Error())
		}
		result.Storage = paths
	}

	if *sendSlack {
		response := slack.Send(ctx, result.TelegramReport, slack.Options{})
		result.Delivery = response
		if !response.OK {
			result.ToolErrors = append(result.ToolErrors, model.ToolError{Tool: "slack", Error: response.Error})
		}
	}

	if *outputJSON {
		data, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			exitError("json output failed: " + err.Error())
		}
		fmt.Println(string(data))
		return
	}
	fmt.Println(result.TelegramReport)
}

func exitError(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
