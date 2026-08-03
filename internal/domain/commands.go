package domain

type ExecutionMode string

const (
	ExecutionNative ExecutionMode = "native"
	ExecutionCLI    ExecutionMode = "cli"
	ExecutionInfo   ExecutionMode = "info"
)

type ArgumentSpec struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Required    bool     `json:"required,omitempty"`
	ValueHint   string   `json:"value_hint,omitempty"`
	Suggestions []string `json:"suggestions,omitempty"`
}

type CommandSpec struct {
	Name        string         `json:"name"`
	Aliases     []string       `json:"aliases,omitempty"`
	Description string         `json:"description,omitempty"`
	Category    string         `json:"category,omitempty"`
	Arguments   []ArgumentSpec `json:"arguments,omitempty"`
	Mode        ExecutionMode  `json:"mode"`
	Dangerous   bool           `json:"dangerous,omitempty"`
}

func DefaultCommandCatalog() []CommandSpec {
	return []CommandSpec{
		// Run
		{Name: "run", Description: "Start a new agent run", Category: "run", Mode: ExecutionCLI, Arguments: []ArgumentSpec{{Name: "prompt", ValueHint: "text"}}},
		{Name: "exec", Aliases: []string{"e"}, Description: "Run a prompt non-interactively", Category: "run", Mode: ExecutionCLI, Dangerous: true, Arguments: []ArgumentSpec{{Name: "prompt", Required: true, ValueHint: "text"}}},
		{Name: "resume", Description: "Browse and resume saved sessions", Category: "sessions", Mode: ExecutionCLI},
		{Name: "stop", Description: "Stop the running agent", Category: "run", Mode: ExecutionNative},
		{Name: "undo", Description: "Undo the last change (snapshot)", Category: "workflow", Mode: ExecutionNative},
		{Name: "redo", Description: "Redo the last undone change (snapshot)", Category: "workflow", Mode: ExecutionNative},
		{Name: "snapshot", Description: "Snapshot, undo, or redo project state", Category: "workflow", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "action", Suggestions: []string{"snapshot", "undo", "redo", "list"}}}},
		{Name: "compact", Description: "Summarise the session context with the small model", Category: "workflow", Mode: ExecutionNative},
		{Name: "goal", Description: "Track an objective with steps and a token budget", Category: "workflow", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "task", ValueHint: "text"}, {Name: "action", Suggestions: []string{"list", "create", "update", "step", "abort", "delete"}}}},
		{Name: "apply", Description: "Apply the latest agent diff", Category: "workflow", Mode: ExecutionCLI, Dangerous: true, Arguments: []ArgumentSpec{{Name: "--dry-run", Description: "Check without applying"}}},
		// Sessions
		{Name: "sessions", Aliases: []string{"session"}, Description: "List and manage saved sessions", Category: "sessions", Mode: ExecutionCLI},
		{Name: "fork", Description: "Fork a saved session", Category: "sessions", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "id", Required: true, ValueHint: "session-id"}}},
		{Name: "rename", Description: "Rename a saved session", Category: "sessions", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "id", Required: true, ValueHint: "session-id"}, {Name: "title", Required: true, ValueHint: "text"}}},
		{Name: "category", Description: "Set a session category (blank resets to date-based)", Category: "sessions", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "id", Required: true, ValueHint: "session-id"}, {Name: "category", ValueHint: "text"}}},
		{Name: "favorite", Aliases: []string{"fav"}, Description: "Toggle a session favourite", Category: "sessions", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "id", Required: true, ValueHint: "session-id"}}},
		{Name: "search", Description: "Search saved sessions", Category: "sessions", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "query", Required: true, ValueHint: "text"}}},
		{Name: "export", Description: "Export a session as JSON", Category: "sessions", Mode: ExecutionCLI, Arguments: []ArgumentSpec{{Name: "id", Required: true, ValueHint: "session-id"}}},
		{Name: "import", Description: "Import a session from a file", Category: "sessions", Mode: ExecutionCLI, Arguments: []ArgumentSpec{{Name: "file", Required: true, ValueHint: "path"}}},
		// Models & providers
		{Name: "models", Description: "List available models", Category: "models", Mode: ExecutionCLI},
		{Name: "model", Description: "Show the active model", Category: "models", Mode: ExecutionNative},
		{Name: "agent", Description: "Choose the agent type for new runs", Category: "models", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "type", Suggestions: []string{"build", "general", "explore"}}}},
		// Environment & permissions
		{Name: "thinking", Description: "Adjust the reasoning effort for new runs", Category: "environment", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "level", Suggestions: []string{"auto", "off", "low", "medium", "high"}}}},
		{Name: "permissions", Aliases: []string{"permission"}, Description: "Set the permission profile", Category: "environment", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "profile", Suggestions: []string{"readonly", "standard", "trusted", "ci"}}}},
		{Name: "sandbox", Description: "Set the sandbox policy", Category: "environment", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "mode", Suggestions: []string{"read-only", "workspace-write", "trusted", "off"}}}},
		{Name: "yolo", Description: "Toggle YOLO approval bypass", Category: "environment", Mode: ExecutionNative},
		{Name: "theme", Description: "Change the desktop theme", Category: "environment", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "theme", Suggestions: []string{"graphite", "charcoal", "dracula", "midnight", "nord", "gruvbox", "github-dark", "tokyo-night", "catppuccin", "one-dark", "solarized-dark", "light", "system"}}}},
		// Tools
		{Name: "tools", Description: "Show registered tools and MCP servers", Category: "tools", Mode: ExecutionNative},
		{Name: "mcp", Description: "Show MCP server connection state", Category: "tools", Mode: ExecutionNative},
		{Name: "plugins", Description: "List and toggle plugins", Category: "tools", Mode: ExecutionNative, Arguments: []ArgumentSpec{{Name: "action", Suggestions: []string{"list", "toggle"}}, {Name: "name", ValueHint: "plugin-name"}}},
		{Name: "agents", Description: "Inspect live subagents", Category: "tools", Mode: ExecutionNative},
		{Name: "skills", Description: "List available skills", Category: "tools", Mode: ExecutionCLI},
		// Diagnostics & maintenance
		{Name: "config", Description: "Show the resolved configuration", Category: "diagnostics", Mode: ExecutionCLI},
		{Name: "doctor", Description: "Check the Rick installation and environment", Category: "diagnostics", Mode: ExecutionCLI, Arguments: []ArgumentSpec{{Name: "--network", Description: "Probe provider endpoints"}}},
		{Name: "security", Description: "Audit dependencies for vulnerabilities", Category: "diagnostics", Mode: ExecutionCLI, Arguments: []ArgumentSpec{{Name: "--format", Suggestions: []string{"table", "json"}}}},
		{Name: "stats", Description: "Show usage statistics", Category: "diagnostics", Mode: ExecutionNative},
		{Name: "usage", Description: "Show token usage", Category: "diagnostics", Mode: ExecutionCLI},
		{Name: "version", Description: "Show the Rick version", Category: "maintenance", Mode: ExecutionCLI},
		{Name: "update", Description: "Update Rick", Category: "maintenance", Mode: ExecutionCLI, Dangerous: true},
		{Name: "uninstall", Description: "Uninstall Rick", Category: "maintenance", Mode: ExecutionCLI, Dangerous: true},
		{Name: "serve", Description: "Run the rickserve daemon in the foreground", Category: "maintenance", Mode: ExecutionCLI, Dangerous: true},
		{Name: "help", Aliases: []string{"?"}, Description: "Show available commands", Category: "general", Mode: ExecutionNative},
		{Name: "new", Aliases: []string{"clear"}, Description: "Start a new thread", Category: "general", Mode: ExecutionNative},
		{Name: "settings", Description: "Open the settings panel", Category: "general", Mode: ExecutionNative},
	}
}
