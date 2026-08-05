package domain

type SecretStatus struct {
	Configured bool   `json:"configured"`
	Masked     bool   `json:"masked"`
	Source     string `json:"source,omitempty"`
}

type AppConfig struct {
	SchemaVersion       int    `json:"schema_version"`
	Model               string `json:"model,omitempty"`
	Theme               string `json:"theme,omitempty"`
	FontSize            string `json:"font_size,omitempty"`
	PermissionProfile   string `json:"permission_profile,omitempty"`
	Sandbox             string `json:"sandbox,omitempty"`
	ShowReasoning       bool   `json:"show_reasoning"`
	ReasoningExpanded   bool   `json:"reasoning_expanded"`
	MaxSwarmConcurrency int    `json:"max_swarm_concurrency"`
	ThinkingMode        string `json:"thinking_mode,omitempty"`
	Yolo                bool   `json:"yolo"`
	RickservePath       string `json:"rickserve_path,omitempty"`
	WorkspacePath       string `json:"workspace_path,omitempty"`
	BackgroundMode      string `json:"background_mode,omitempty"`
	BackgroundPath      string `json:"background_path,omitempty"`
	// BackgroundTransparency is 0-100; higher means more of the image shows
	// through the theme-tinted scrim. 38 keeps the previous 62% scrim default.
	BackgroundTransparency int            `json:"background_transparency,omitempty"`
	Unknown                map[string]any `json:"-"`
}

func DefaultConfig() AppConfig {
	return AppConfig{
		SchemaVersion:          2,
		Theme:                  "graphite",
		FontSize:               "medium",
		PermissionProfile:      "standard",
		Sandbox:                "workspace-write",
		ShowReasoning:          true,
		ReasoningExpanded:      true,
		MaxSwarmConcurrency:    4,
		ThinkingMode:           "auto",
		Yolo:                   false,
		BackgroundMode:         "theme",
		BackgroundTransparency: 38,
	}
}
