package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Tool struct {
	Name     string `json:"name"`
	Status   string `json:"status,omitempty"`
	Type     string `json:"type,omitempty"`
	Command  string `json:"command,omitempty"`
	Cost     string `json:"cost,omitempty"`
	Priority string `json:"priority,omitempty"`
}

type Result struct {
	OK         bool   `json:"ok"`
	ObservedAt string `json:"observed_at"`
	Tools      []Tool `json:"tools"`
	Report     string `json:"report"`
}

func main() {
	jsonOutput := flag.Bool("json", false, "print JSON result")
	catalogPath := flag.String("catalog", "../openclaw_workspace/config/tool_catalog.yaml", "tool catalog path")
	flag.Parse()

	tools, err := parseCatalog(*catalogPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "tool_status failed: %v\n", err)
		os.Exit(1)
	}
	result := Result{
		OK:         true,
		ObservedAt: time.Now().UTC().Format(time.RFC3339),
		Tools:      tools,
		Report:     renderStatus(tools),
	}
	if *jsonOutput {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		return
	}
	fmt.Println(result.Report)
}

func parseCatalog(path string) ([]Tool, error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return nil, err
	}
	tools := []Tool{}
	var current *Tool
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "    ") && strings.HasSuffix(strings.TrimSpace(line), ":") {
			name := strings.TrimSuffix(strings.TrimSpace(line), ":")
			tools = append(tools, Tool{Name: name})
			current = &tools[len(tools)-1]
			continue
		}
		if current == nil || !strings.HasPrefix(line, "    ") {
			continue
		}
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), `"`)
		switch key {
		case "status":
			current.Status = value
		case "type":
			current.Type = value
		case "command":
			current.Command = value
		case "cost":
			current.Cost = value
		case "priority":
			current.Priority = value
		}
	}
	return tools, nil
}

func renderStatus(tools []Tool) string {
	lines := []string{"Company Detection Tool Status", ""}
	for _, tool := range tools {
		status := tool.Status
		if status == "" {
			status = "unknown"
		}
		priority := tool.Priority
		if priority == "" {
			priority = "no_priority"
		}
		lines = append(lines, fmt.Sprintf("- %s: %s (%s)", tool.Name, status, priority))
	}
	return strings.Join(lines, "\n")
}
