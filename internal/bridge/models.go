package bridge

import (
	"encoding/json"
	"fmt"
	"strings"
)

type ModelInfo struct {
	Provider           string   `json:"provider"`
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	ContextWindow      int      `json:"context_window"`
	Source             string   `json:"source"`
	Configured         bool     `json:"configured"`
	Default            bool     `json:"default"`
	ReasoningEfforts   []string `json:"reasoning_efforts,omitempty"`
	ReasoningDefault   string   `json:"reasoning_default,omitempty"`
	ReasoningMandatory bool     `json:"reasoning_mandatory,omitempty"`
}

type modelsResponse struct {
	Type  string          `json:"type"`
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}

func DecodeModels(raw json.RawMessage) ([]ModelInfo, error) {
	var response modelsResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	if response.Type == "error" || response.Error != "" {
		return nil, fmt.Errorf("rickserve models: %s", response.Error)
	}
	if len(response.Data) == 0 || string(response.Data) == "null" {
		return []ModelInfo{}, nil
	}
	// Current rickserve emits a bare array; legacy versions wrapped it as {"models":[...]}.
	var models []ModelInfo
	if err := json.Unmarshal(response.Data, &models); err == nil {
		return models, nil
	}
	var wrapped struct {
		Models []ModelInfo `json:"models"`
	}
	if err := json.Unmarshal(response.Data, &wrapped); err != nil {
		return nil, fmt.Errorf("decode models data: %w", err)
	}
	return wrapped.Models, nil
}

func IsConfiguredModel(model ModelInfo) bool {
	// Current rickserve only lists models from configured providers (already
	// filtered through FilterChatModels), so every entry is usable. The
	// legacy source/configured flags remain for old fixtures.
	return model.Configured || strings.EqualFold(model.Source, "configured") || (!model.Configured && model.Source == "")
}

// ToolInfo is one tool reported by rickserve's tools endpoint. The list is
// the daemon's live registry, so it always matches what the agent loop (and
// therefore the TUI) actually exposes.
type ToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func DecodeTools(raw json.RawMessage) ([]ToolInfo, error) {
	var response modelsResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, fmt.Errorf("decode tools response: %w", err)
	}
	if response.Type == "error" || response.Error != "" {
		return nil, fmt.Errorf("rickserve tools: %s", response.Error)
	}
	if len(response.Data) == 0 || string(response.Data) == "null" {
		return []ToolInfo{}, nil
	}
	var tools []ToolInfo
	if err := json.Unmarshal(response.Data, &tools); err != nil {
		return nil, fmt.Errorf("decode tools data: %w", err)
	}
	return tools, nil
}
