package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"rickdesktop/internal/bridge"
	"rickdesktop/internal/commands"
	"rickdesktop/internal/config"
	"rickdesktop/internal/domain"
	"rickdesktop/internal/extensions"
	"rickdesktop/internal/nvpn"
	"rickdesktop/internal/sessions"
	"rickdesktop/internal/timelinecache"
	"rickdesktop/internal/usage"
)

type App struct {
	ctx                context.Context
	bridge             *bridge.Service
	configStore        *config.Store
	sessionStore       *sessions.Store
	timelineStore      *timelinecache.Store
	extensions         *extensions.Registry
	nvpn               *nvpn.Service
	openvpn            *nvpn.OpenVPNService
	mu                 sync.Mutex
	currentRunID       string
	currentSessionID   string
	lastUsage          domain.Usage
	lastUsageSessionID string

	// Short-lived caches that keep read-only protocol queries from spawning a
	// fresh rickserve process on every keystroke/mount. Mutating actions
	// bypass and invalidate them.
	oneShotCache   map[string]oneShotCacheEntry
	versionCache   cachedValue[string]
	providersCache cachedValue[[]Provider]
}

type cachedValue[T any] struct {
	value   T
	expires time.Time
}

func (c *cachedValue[T]) get() (T, bool) {
	if time.Now().Before(c.expires) {
		return c.value, true
	}
	var zero T
	return zero, false
}

func (c *cachedValue[T]) set(value T) {
	c.value = value
	c.expires = time.Now().Add(30 * time.Second)
}

// invalidate expires the cached value immediately so the next read re-fetches.
func (c *cachedValue[T]) invalidate() {
	c.expires = time.Time{}
}

type oneShotCacheEntry struct {
	data    json.RawMessage
	expires time.Time
}

// oneShotCacheTTL keeps read-only protocol queries cheap so settings, auth and
// MCP panels open instantly; 5s is short enough to stay fresh.
const oneShotCacheTTL = 5 * time.Second

func NewApp() *App {
	app := &App{}
	app.configStore = config.NewStore(app.desktopSettingsPath())
	app.sessionStore = sessions.NewStore(app.sessionsPath())
	app.timelineStore = timelinecache.New(filepath.Join(filepath.Dir(app.sessionsPath()), ".rickdesktop", "timelines"))
	app.oneShotCache = make(map[string]oneShotCacheEntry, 8)
	registry, err := extensions.NewRegistry(filepath.Join(app.rickConfigDir(), "extensions.json"))
	if err != nil {
		// A corrupt registry must not prevent the app from starting; the
		// extensions tab will surface the error when it lists them.
		println("extensions registry:", err.Error())
		registry, _ = extensions.NewRegistry("")
	}
	app.extensions = registry
	app.nvpn = nvpn.New()
	app.openvpn = nvpn.NewOpenVPN(filepath.Join(app.rickConfigDir(), "nvpn"))
	return app
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.emitRickStatus()
	a.startUpdateCheck()
	a.maybeAutoConnectNvpn()
	a.startRickserve()
}

// maybeAutoConnectNvpn connects the tunnel at startup when the NVPN extension
// is enabled, "auto connect on start" is on, and the matching credentials are
// saved. Runs before rickserve starts so its traffic is proxied from the
// beginning.
func (a *App) maybeAutoConnectNvpn() {
	if !a.extensions.Enabled(extensions.BuiltinNVPN.ID) {
		return
	}
	state, err := a.extensions.NVPN()
	if err != nil {
		a.EmitError(err)
		return
	}
	if state.OpenVPNAutoConnect && state.OpenVPNUsername != "" && state.OpenVPNPassword != "" {
		if _, err := a.openvpn.Connect(state.OpenVPNUsername, state.OpenVPNPassword); err != nil {
			a.EmitError(fmt.Errorf("NVPN auto-connect: %w", err))
		} else {
			a.restartRickserve()
		}
		return
	}
	if !state.AutoConnect || strings.TrimSpace(state.Username) == "" || strings.TrimSpace(state.Password) == "" {
		return
	}
	if _, err := a.nvpn.Connect(state.Username, state.Password); err != nil {
		a.EmitError(fmt.Errorf("NVPN auto-connect: %w", err))
	}
}

func (a *App) shutdown(_ context.Context) {
	a.stopRickserve()
	_ = a.nvpn.Stop()
}

// rickserveEnv is the environment for rickserve processes (the long-running
// daemon and one-shot queries). When NVPN is connected, outbound traffic is
// routed through the local tunnel proxy so provider API requests go over the
// VPN.
func (a *App) rickserveEnv() []string {
	env := os.Environ()
	if proxyURL := a.nvpn.ProxyURL(); proxyURL != "" {
		env = append(env, "HTTP_PROXY="+proxyURL, "HTTPS_PROXY="+proxyURL, "ALL_PROXY="+proxyURL)
	}
	return env
}

func (a *App) startRickserve() {
	path, err := a.findRickserve()
	if err != nil {
		a.EmitError(err)
		return
	}
	a.mu.Lock()
	if a.bridge != nil && a.bridge.Running() {
		a.mu.Unlock()
		return
	}
	a.bridge = bridge.NewService(path, a.handleRickEvent, a.EmitError)
	a.bridge.SetEnv(a.rickserveEnv())
	service := a.bridge
	a.mu.Unlock()
	if err := service.Start(); err != nil {
		a.EmitError(err)
	}
}

// restartRickserve bounces the daemon so a changed proxy environment takes
// effect (rickserve inherits HTTP_PROXY/HTTPS_PROXY at spawn time).
func (a *App) restartRickserve() {
	a.stopRickserve()
	a.startRickserve()
}

func (a *App) stopRickserve() {
	a.mu.Lock()
	service := a.bridge
	a.bridge = nil
	a.mu.Unlock()
	if service != nil {
		_ = service.Stop()
	}
}

func (a *App) findRickserve() (string, error) {
	return a.resolveRickservePath()
}

func (a *App) EmitEvent(name string, payload any) {
	if a.ctx == nil || a.ctx.Value("events") == nil {
		return
	}
	select {
	case <-a.ctx.Done():
		return
	default:
		wailsruntime.EventsEmit(a.ctx, name, payload)
	}
}

func (a *App) EmitError(err error) {
	if err == nil {
		return
	}
	a.EmitEvent("rick:error", map[string]any{"error": err.Error()})
}

func (a *App) handleRickEvent(event domain.RickEvent) {
	var data any
	if len(event.RawData) > 0 && string(event.RawData) != "null" {
		_ = json.Unmarshal(event.RawData, &data)
	}
	payload := FrontendEvent{
		Type:      event.Type,
		RequestID: event.RequestID,
		RunID:     event.RunID,
		SessionID: event.SessionID,
		MessageID: event.MessageID,
		AgentID:   event.AgentID,
		SwarmID:   event.SwarmID,
		Event:     event.RawName,
		Kind:      string(event.Kind),
		Sequence:  event.Sequence,
		Text:      event.Text,
		Error:     event.Error,
		Data:      data,
		RawData:   event.RawData,
		Raw:       event.Raw,
	}
	if event.Usage != nil {
		payload.Usage = event.Usage
		a.mu.Lock()
		a.lastUsage = *event.Usage
		a.lastUsageSessionID = event.SessionID
		a.mu.Unlock()
	}
	a.EmitEvent("rick:event", payload)
}

type FrontendEvent struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id,omitempty"`
	RunID     string          `json:"run_id,omitempty"`
	SessionID string          `json:"session_id,omitempty"`
	MessageID string          `json:"message_id,omitempty"`
	AgentID   string          `json:"agent_id,omitempty"`
	SwarmID   string          `json:"swarm_id,omitempty"`
	Event     string          `json:"event,omitempty"`
	Kind      string          `json:"kind,omitempty"`
	Sequence  int64           `json:"sequence,omitempty"`
	Text      string          `json:"text,omitempty"`
	Error     string          `json:"error,omitempty"`
	Usage     *domain.Usage   `json:"usage,omitempty"`
	Data      any             `json:"data,omitempty"`
	RawData   json.RawMessage `json:"raw_data,omitempty"`
	Raw       json.RawMessage `json:"raw,omitempty"`
}

type RunOptions struct {
	RunID             string       `json:"run_id,omitempty"`
	MaxTurns          int          `json:"max_turns,omitempty"`
	PermissionProfile string       `json:"permission_profile,omitempty"`
	Sandbox           string       `json:"sandbox,omitempty"`
	Thinking          string       `json:"thinking,omitempty"`
	Yolo              bool         `json:"yolo,omitempty"`
	Agent             string       `json:"agent,omitempty"`
	Cwd               string       `json:"cwd,omitempty"`
	Attachments       []Attachment `json:"attachments,omitempty"`
}

// Attachment is one file attached to a run, base64-encoded on the wire.
type Attachment struct {
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

func (a *App) RunPrompt(prompt, model, sessionID string) (string, error) {
	config, err := a.configStore.Load()
	if err != nil {
		return "", err
	}
	return a.runPrompt(prompt, model, sessionID, RunOptions{PermissionProfile: config.PermissionProfile, Sandbox: config.Sandbox, Thinking: config.ThinkingMode, Yolo: config.Yolo})
}

func (a *App) RunPromptWithOptions(prompt, model, sessionID string, options RunOptions) (string, error) {
	return a.runPrompt(prompt, model, sessionID, options)
}

func (a *App) runPrompt(prompt, model, sessionID string, options RunOptions) (string, error) {
	if strings.TrimSpace(prompt) == "" {
		return "", errors.New("prompt cannot be empty")
	}
	a.mu.Lock()
	service := a.bridge
	a.mu.Unlock()
	if service == nil || !service.Running() {
		a.startRickserve()
		a.mu.Lock()
		service = a.bridge
		a.mu.Unlock()
	}
	if service == nil {
		return "", errors.New("rickserve is not available")
	}
	runID := options.RunID
	if runID == "" {
		runID = bridge.NewRequestID("run")
	}
	requestID := bridge.NewRequestID("request")
	request := map[string]any{
		"type":       "run",
		"request_id": requestID,
		"run_id":     runID,
		"prompt":     prompt,
		"model":      model,
	}
	if sessionID != "" {
		request["session_id"] = sessionID
		request["resume"] = true
	} else {
		// Always mint a session id so interrupt can target this run even on
		// the first message of a new chat, and so the caller can register the
		// session in the sidebar before the daemon persists it.
		sessionID = fmt.Sprintf("desk-%d", time.Now().UnixNano())
		request["session_id"] = sessionID
	}
	if options.MaxTurns > 0 {
		request["max_turns"] = options.MaxTurns
	}
	if options.PermissionProfile != "" {
		request["permission_profile"] = options.PermissionProfile
	}
	if options.Sandbox != "" {
		request["sandbox"] = options.Sandbox
	}
	if options.Thinking != "" {
		request["thinking"] = options.Thinking
	}
	if options.Yolo {
		request["yolo"] = true
	}
	if options.Agent != "" {
		request["agent"] = options.Agent
	}
	if options.Cwd != "" {
		request["cwd"] = options.Cwd
	} else if config, err := a.configStore.Load(); err == nil && config.WorkspacePath != "" {
		// Runs without an explicit cwd fall back to the workspace selected in
		// the sidebar, so new threads and CLI/desktop share the same path.
		request["cwd"] = config.WorkspacePath
	}
	if len(options.Attachments) > 0 {
		request["attachments"] = options.Attachments
	}
	a.mu.Lock()
	a.currentRunID = runID
	a.currentSessionID = sessionID
	a.mu.Unlock()
	if err := service.Send(request); err != nil {
		return "", err
	}
	return sessionID, nil
}

// StopRun interrupts the run for the given session, falling back to the most
// recently started run when no id is supplied (e.g. a fresh thread whose
// run has just been dispatched).
func (a *App) StopRun(sessionID, runID string) error {
	a.mu.Lock()
	if sessionID == "" {
		sessionID = a.currentSessionID
	}
	service := a.bridge
	a.mu.Unlock()
	if service == nil {
		return nil
	}
	if sessionID != "" {
		// Interrupt the live run through the protocol instead of killing the
		// daemon, so the session is saved and the stream reports "cancelled".
		request := map[string]any{"type": "interrupt", "session_id": sessionID}
		if runID != "" {
			request["run_id"] = runID
		}
		if err := service.Send(request); err != nil {
			return err
		}
	}
	return nil
}

// RespondPermission routes an approval decision back to the waiting run.
func (a *App) RespondPermission(requestID, decision string) error {
	switch decision {
	case "accept", "reject", "always":
	default:
		return fmt.Errorf("unknown decision %q (want accept, reject or always)", decision)
	}
	a.mu.Lock()
	service := a.bridge
	a.mu.Unlock()
	if service == nil {
		return errors.New("rickserve is not available")
	}
	return service.Send(map[string]any{
		"type":       "permission_response",
		"request_id": requestID,
		"decision":   decision,
	})
}

// ---------- protocol queries ----------

// queryOneShot sends a single request to a fresh rickserve process and
// returns the decoded "data" field of the terminal response. These queries
// read state that persists on disk (config, sessions, goals, snapshots,
// MCP/plugin registries), so a fresh process is equivalent to the live one.
func (a *App) queryOneShot(request map[string]any) (json.RawMessage, error) {
	path, err := a.findRickserve()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	responses, err := bridge.OneShot(ctx, path, request, a.rickserveEnv())
	if err != nil {
		return nil, err
	}
	if len(responses) == 0 {
		return nil, errors.New("rickserve returned no response")
	}
	var value struct {
		Type  string          `json:"type"`
		Error string          `json:"error"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(responses[len(responses)-1], &value); err != nil {
		return nil, fmt.Errorf("decode rickserve response: %w", err)
	}
	if value.Type == "error" {
		if value.Error != "" {
			return nil, errors.New(value.Error)
		}
		return nil, errors.New("rickserve request failed")
	}
	return value.Data, nil
}

// queryOneShotCached serves read-only protocol queries from a short-lived
// cache so repeat calls (settings open, tab switches, auth/MCP panels) do not
// each spawn a fresh rickserve process. Mutating actions bypass the cache and
// clear it, so a subsequent read always reflects the new state.
func (a *App) queryOneShotCached(request map[string]any) (json.RawMessage, error) {
	if !cacheableQuery(request) {
		a.mu.Lock()
		a.oneShotCache = make(map[string]oneShotCacheEntry, 8)
		a.mu.Unlock()
		return a.queryOneShot(request)
	}
	keyBytes, err := json.Marshal(request)
	if err != nil {
		return a.queryOneShot(request)
	}
	key := string(keyBytes)
	a.mu.Lock()
	if entry, ok := a.oneShotCache[key]; ok && time.Now().Before(entry.expires) {
		data := entry.data
		a.mu.Unlock()
		return data, nil
	}
	a.mu.Unlock()
	data, err := a.queryOneShot(request)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.oneShotCache[key] = oneShotCacheEntry{data: bytes.Clone(data), expires: time.Now().Add(oneShotCacheTTL)}
	a.mu.Unlock()
	return data, nil
}

// cacheableQuery reports whether a protocol request is a pure read. Write
// actions (config set, auth save/update/add_keys, snapshot undo/redo,
// goal create/update/abort/delete, plugin toggle, agent kill/send/steer) are
// never cached.
func cacheableQuery(request map[string]any) bool {
	action, _ := request["action"].(string)
	switch request["type"] {
	case "config", "auth", "mcp", "plugins", "agents", "goal", "snapshot", "models":
		switch action {
		case "", "list", "can", "active":
			return true
		}
	}
	return false
}

// GetResolvedConfig returns the config resolution the rickserve daemon sees:
// project root, global/data dirs, sources, and the merged rick config/TUI.
func (a *App) GetResolvedConfig(cwd string) (map[string]any, error) {
	request := map[string]any{"type": "config"}
	if cwd != "" {
		request["cwd"] = cwd
	}
	data, err := a.queryOneShotCached(request)
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// UpdateRickConfig persists a set of keys into Rick's canonical global config
// (rick.json / tui.json) through the daemon, so the terminal and desktop stay
// in sync. Nil values clear a key back to its default.
func (a *App) UpdateRickConfig(patch map[string]any) (map[string]any, error) {
	if len(patch) == 0 {
		return nil, errors.New("empty config patch")
	}
	data, err := a.queryOneShotCached(map[string]any{"type": "config", "action": "set", "patch": patch})
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// RequestSnapshot runs snapshot actions: list, can, undo, redo, snapshot.
func (a *App) RequestSnapshot(action, cwd, title string) (map[string]any, error) {
	request := map[string]any{"type": "snapshot", "action": action}
	if cwd != "" {
		request["cwd"] = cwd
	}
	if title != "" {
		request["title"] = title
	}
	data, err := a.queryOneShotCached(request)
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// RequestGoals runs goal actions: list, create, update, step, abort, delete,
// set_active, active.
func (a *App) RequestGoals(action, goalID, stepID, title, content, status string, budget int, steps []string) (map[string]any, error) {
	request := map[string]any{"type": "goal", "action": action}
	if goalID != "" {
		request["goal_id"] = goalID
	}
	if stepID != "" {
		request["step_id"] = stepID
	}
	if title != "" {
		request["title"] = title
	}
	if content != "" {
		request["content"] = content
	}
	if status != "" {
		request["status"] = status
	}
	if budget > 0 {
		request["budget"] = budget
	}
	if len(steps) > 0 {
		request["steps"] = steps
	}
	data, err := a.queryOneShotCached(request)
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// RequestCompact summarises a stored session via the small model.
func (a *App) RequestCompact(sessionID string) (map[string]any, error) {
	data, err := a.queryOneShot(map[string]any{"type": "compact", "session_id": sessionID})
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// GetMCPStatus lists connected MCP servers and their tools.
func (a *App) GetMCPStatus() ([]map[string]any, error) {
	data, err := a.queryOneShotCached(map[string]any{"type": "mcp"})
	if err != nil {
		return nil, err
	}
	var value []map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// RequestPlugins lists, toggles, adds (from a file path or URL), or removes
// loaded plugins.
func (a *App) RequestPlugins(action, name, source string, enabled *bool) (any, error) {
	request := map[string]any{"type": "plugins", "action": action}
	if name != "" {
		request["name"] = name
	}
	if source != "" {
		request["source"] = source
	}
	if enabled != nil {
		request["enabled"] = *enabled
	}
	data, err := a.queryOneShotCached(request)
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// AuthProvider is one provider row as rick's /auth flow lists it.
type AuthProvider struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Type         string `json:"type"`
	Auth         string `json:"auth"`
	Connected    bool   `json:"connected"`
	EnvOnly      bool   `json:"env_only"`
	Custom       bool   `json:"custom"`
	EnvVar       string `json:"env_var,omitempty"`
	BaseURL      string `json:"base_url,omitempty"`
	Detail       string `json:"detail,omitempty"`
	ModelCount   int    `json:"model_count,omitempty"`
	DefaultModel string `json:"default_model,omitempty"`
	KeyCount     int    `json:"key_count,omitempty"`
	MaskedKey    string `json:"masked_key,omitempty"`
	KeyMode      string `json:"key_mode,omitempty"`
	OnlyFree     bool   `json:"only_free,omitempty"`
	Disabled     bool   `json:"disabled,omitempty"`
}

// getAuthRows runs an auth request and decodes the provider rows.
func (a *App) getAuthRows(request map[string]any) ([]AuthProvider, error) {
	data, err := a.queryOneShotCached(request)
	if err != nil {
		return nil, err
	}
	var rows []AuthProvider
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// GetAuthStatus lists every provider with its connection state, matching the
// /auth flow in the terminal (configured first, then the catalog).
func (a *App) GetAuthStatus() ([]AuthProvider, error) {
	return a.getAuthRows(map[string]any{"type": "auth"})
}

// SaveProvider writes an API key / base URL for a provider into Rick's
// auth.json and returns the refreshed provider list.
func (a *App) SaveProvider(provider, apiKey, baseURL, label string) ([]AuthProvider, error) {
	a.providersCache.invalidate() // the model list may change after adding a provider
	return a.getAuthRows(map[string]any{
		"type": "auth", "action": "save",
		"provider": provider, "api_key": apiKey,
		"base_url": baseURL, "label": label,
	})
}

// UpdateProvider patches a provider's metadata (only_free, disabled, key
// rotation mode, base URL, label, default model) and returns the refreshed
// list. Pass empty strings for fields that should stay unchanged.
func (a *App) UpdateProvider(provider string, onlyFree, disabled *bool, keyMode, baseURL, label, defaultModel string) ([]AuthProvider, error) {
	request := map[string]any{
		"type": "auth", "action": "update", "provider": provider,
	}
	if onlyFree != nil {
		request["only_free"] = *onlyFree
	}
	if disabled != nil {
		request["disabled"] = *disabled
	}
	if keyMode != "" {
		request["key_mode"] = keyMode
	}
	if baseURL != "" {
		request["base_url"] = baseURL
	}
	if label != "" {
		request["label"] = label
	}
	if defaultModel != "" {
		request["default_model"] = defaultModel
	}
	a.providersCache.invalidate() // the model list may change (only_free/base_url)
	return a.getAuthRows(request)
}

// AddProviderKeys appends one or more API keys to a provider and returns the
// refreshed provider list.
func (a *App) AddProviderKeys(provider string, keys []string) ([]AuthProvider, error) {
	a.providersCache.invalidate()
	return a.getAuthRows(map[string]any{
		"type": "auth", "action": "add_keys",
		"provider": provider, "api_keys": keys,
	})
}

// RemoveProviderKey removes the key at the 1-based position and returns the
// refreshed provider list.
func (a *App) RemoveProviderKey(provider string, keyIndex int) ([]AuthProvider, error) {
	a.providersCache.invalidate()
	return a.getAuthRows(map[string]any{
		"type": "auth", "action": "remove_key",
		"provider": provider, "key_index": keyIndex,
	})
}

// RemoveProvider deletes a provider credential from Rick's auth.json and
// returns the refreshed provider list.
func (a *App) RemoveProvider(provider string) ([]AuthProvider, error) {
	a.providersCache.invalidate()
	return a.getAuthRows(map[string]any{"type": "auth", "action": "remove", "provider": provider})
}

// ---------- live agent control ----------

// sendLive writes a control request to the running daemon; responses arrive
// as "agents" events on the rick:event stream.
func (a *App) sendLive(request map[string]any) error {
	a.mu.Lock()
	service := a.bridge
	a.mu.Unlock()
	if service == nil || !service.Running() {
		return errors.New("rickserve is not running")
	}
	return service.Send(request)
}

func (a *App) ListAgents(sessionID string) error {
	return a.sendLive(map[string]any{"type": "agents", "action": "list", "session_id": sessionID})
}

func (a *App) KillAgent(sessionID, agentID string) error {
	return a.sendLive(map[string]any{"type": "agents", "action": "kill", "session_id": sessionID, "agent_id": agentID})
}

func (a *App) SteerAgent(sessionID, agentID, from, content string) error {
	return a.sendLive(map[string]any{"type": "agents", "action": "steer", "session_id": sessionID, "agent_id": agentID, "from": from, "content": content})
}

func (a *App) GetProviders() ([]Provider, error) {
	if value, ok := a.providersCache.get(); ok {
		return value, nil
	}
	path, err := a.findRickserve()
	if err != nil {
		return nil, err
	}
	responses, err := bridge.OneShot(context.Background(), path, map[string]any{"type": "models"}, a.rickserveEnv())
	if err != nil {
		return nil, err
	}
	if len(responses) == 0 {
		return []Provider{}, nil
	}
	models, err := bridge.DecodeModels(responses[len(responses)-1])
	if err != nil {
		return nil, err
	}
	providers := map[string]*Provider{}
	order := []string{}
	for _, info := range models {
		if !bridge.IsConfiguredModel(info) {
			continue
		}
		provider := providers[info.Provider]
		if provider == nil {
			provider = &Provider{Name: info.Provider, Label: info.Provider, Type: a.providerType(info.Provider), Models: []Model{}}
			providers[info.Provider] = provider
			order = append(order, info.Provider)
		}
		provider.Models = append(provider.Models, Model{ID: info.ID, Name: info.Name, Provider: info.Provider, ContextWindow: info.ContextWindow, Configured: info.Configured, IsDefault: info.Default, Free: isFreeModel(info.ID, info.Name), ReasoningEfforts: info.ReasoningEfforts, ReasoningDefault: info.ReasoningDefault, ReasoningMandatory: info.ReasoningMandatory})
	}
	result := make([]Provider, 0, len(order))
	for _, name := range order {
		result = append(result, *providers[name])
	}
	a.providersCache.set(result)
	return result, nil
}

// GetTools reports the live tool registry of the running rickserve daemon,
// so the desktop always mirrors the exact tool set the TUI exposes.
func (a *App) GetTools() ([]bridge.ToolInfo, error) {
	path, err := a.findRickserve()
	if err != nil {
		return nil, err
	}
	responses, err := bridge.OneShot(context.Background(), path, map[string]any{"type": "tools"}, a.rickserveEnv())
	if err != nil {
		return nil, err
	}
	if len(responses) == 0 {
		return []bridge.ToolInfo{}, nil
	}
	return bridge.DecodeTools(responses[len(responses)-1])
}

func (a *App) providerType(name string) string {
	path := filepath.Join(a.rickConfigDir(), "auth.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "openai"
	}
	var value struct {
		Provider map[string]struct {
			Type  string `json:"type"`
			Label string `json:"label"`
		} `json:"provider"`
	}
	if json.Unmarshal(data, &value) != nil {
		return "openai"
	}
	if provider, ok := value.Provider[name]; ok && provider.Type != "" {
		return provider.Type
	}
	return "openai"
}

func isFreeModel(id, name string) bool {
	lowerName := strings.ToLower(name)
	return strings.HasSuffix(id, ":free") || strings.HasSuffix(id, "-free") || strings.Contains(lowerName, "free")
}

type Provider struct {
	Name   string  `json:"name"`
	Label  string  `json:"label"`
	Type   string  `json:"type"`
	Models []Model `json:"models"`
}

type Model struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Provider           string   `json:"provider"`
	ContextWindow      int      `json:"context_window"`
	Configured         bool     `json:"configured"`
	IsDefault          bool     `json:"is_default"`
	Free               bool     `json:"free"`
	ReasoningEfforts   []string `json:"reasoning_efforts,omitempty"`
	ReasoningDefault   string   `json:"reasoning_default,omitempty"`
	ReasoningMandatory bool     `json:"reasoning_mandatory,omitempty"`
}

type Session struct {
	ID       string     `json:"id"`
	Title    string     `json:"title"`
	CWD      string     `json:"cwd"`
	Model    string     `json:"model"`
	Messages int        `json:"messages"`
	Created  string     `json:"created"`
	Updated  string     `json:"updated"`
	Category string     `json:"category,omitempty"`
	Favorite bool       `json:"favorite,omitempty"`
	Usage    TokenUsage `json:"usage"`
}

type TokenUsage struct {
	Input      int `json:"input"`
	Output     int `json:"output"`
	CacheRead  int `json:"cache_read"`
	CacheWrite int `json:"cache_write"`
	Cached     int `json:"cached"`
	Total      int `json:"total"`
}

type UsageStats struct {
	SessionID    string     `json:"session_id,omitempty"`
	Model        string     `json:"model,omitempty"`
	Session      TokenUsage `json:"session"`
	Total        TokenUsage `json:"total"`
	ContextUsed  int        `json:"context_used,omitempty"`
	ContextLimit int        `json:"context_limit,omitempty"`
	ContextKnown bool       `json:"context_known"`
}

type ModelUsage struct {
	Model      string `json:"model"`
	Input      int    `json:"input"`
	Output     int    `json:"output"`
	CacheRead  int    `json:"cache_read"`
	CacheWrite int    `json:"cache_write"`
	Cached     int    `json:"cached"`
	Total      int    `json:"total"`
}

type DailyUsage struct {
	Date   string       `json:"date"`
	Input  int          `json:"input"`
	Output int          `json:"output"`
	Cached int          `json:"cached"`
	Total  int          `json:"total"`
	Models []ModelUsage `json:"models"`
}

func (a *App) GetUsageDaily(days int) ([]DailyUsage, error) {
	if days <= 0 || days > 90 {
		days = 14
	}
	daily, err := usage.ReadDaily(filepath.Join(a.rickConfigDir(), "usage.json"))
	if err != nil {
		return nil, err
	}
	dates := make([]string, 0, len(daily))
	for date := range daily {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	if len(dates) > days {
		dates = dates[len(dates)-days:]
	}
	result := make([]DailyUsage, 0, len(dates))
	for _, date := range dates {
		models := daily[date]
		day := DailyUsage{Date: date, Models: make([]ModelUsage, 0, len(models))}
		for model, counters := range models {
			day.Models = append(day.Models, ModelUsage{Model: model, Input: counters.Input, Output: counters.Output, CacheRead: counters.CacheRead, CacheWrite: counters.CacheWrite, Cached: counters.Cached(), Total: counters.Total()})
			day.Input += counters.Input
			day.Output += counters.Output
			day.Cached += counters.Cached()
		}
		day.Total = day.Input + day.Output + day.Cached
		sort.Slice(day.Models, func(left, right int) bool { return day.Models[left].Total > day.Models[right].Total })
		result = append(result, day)
	}
	return result, nil
}

type ChatMessage struct {
	ID        string                  `json:"id"`
	Role      string                  `json:"role"`
	Content   string                  `json:"content,omitempty"`
	Blocks    []sessions.ContentBlock `json:"blocks,omitempty"`
	Timestamp string                  `json:"timestamp,omitempty"`
	Done      bool                    `json:"done"`
}

func (a *App) GetSessions() ([]Session, error) {
	summaries, err := a.sessionStore.List()
	if err != nil {
		return nil, err
	}
	result := make([]Session, 0, len(summaries))
	known := make(map[string]struct{}, len(summaries))
	for _, summary := range summaries {
		session := sessionFromSummary(summary)
		result = append(result, session)
		known[session.ID] = struct{}{}
	}
	// A new rick session is canonical only after the first run completes. Merge
	// Desktop sidecar metadata so an in-flight prompt remains reachable even if
	// the app restarts before rick writes the canonical file.
	persisted, listErr := a.timelineStore.List()
	if listErr == nil {
		for sessionID, payload := range persisted {
			if _, exists := known[sessionID]; exists {
				continue
			}
			var envelope struct {
				Session Session `json:"session"`
			}
			if json.Unmarshal(payload, &envelope) != nil || envelope.Session.ID != sessionID {
				continue
			}
			result = append(result, envelope.Session)
		}
	}
	sort.SliceStable(result, func(left, right int) bool { return result[left].Updated > result[right].Updated })
	return result, nil
}

func (a *App) GetSessionMessages(sessionID string) ([]ChatMessage, error) {
	messages, err := a.sessionStore.Messages(sessionID)
	if err != nil {
		return nil, err
	}
	result := make([]ChatMessage, 0, len(messages))
	for index, message := range messages {
		result = append(result, ChatMessage{ID: fmt.Sprintf("%s-%d", sessionID, index), Role: message.Role, Content: message.Content, Blocks: message.Blocks, Done: true})
	}
	return result, nil
}

// SaveDesktopTimeline stores the exact formatted UI state for an in-flight
// session. Rick's canonical session remains authoritative after success; this
// sidecar protects optimistic prompts and live event blocks while a run is
// active or interrupted.
func (a *App) SaveDesktopTimeline(sessionID, payload string) error {
	return a.timelineStore.Save(sessionID, []byte(payload))
}

func (a *App) LoadDesktopTimeline(sessionID string) (string, error) {
	payload, err := a.timelineStore.Load(sessionID)
	return string(payload), err
}

func (a *App) DeleteDesktopTimeline(sessionID string) error {
	return a.timelineStore.Delete(sessionID)
}

func (a *App) RenameSession(id, title string) error { return a.sessionStore.Rename(id, title) }
func (a *App) SetSessionCategory(id, category string) error {
	return a.sessionStore.SetCategory(id, category)
}
func (a *App) SetSessionFavorite(id string, fav bool) error {
	return a.sessionStore.SetFavorite(id, fav)
}
func (a *App) DeleteSession(id string) error {
	if err := a.sessionStore.Delete(id); err != nil {
		return err
	}
	return a.timelineStore.Delete(id)
}
func (a *App) ForkSession(id string) (Session, error) {
	summary, err := a.sessionStore.Fork(id)
	if err != nil {
		return Session{}, err
	}
	return sessionFromSummary(summary), nil
}
func (a *App) SearchSessions(query string) ([]Session, error) {
	summaries, err := a.sessionStore.Search(query)
	if err != nil {
		return nil, err
	}
	result := make([]Session, 0, len(summaries))
	for _, summary := range summaries {
		result = append(result, sessionFromSummary(summary))
	}
	return result, nil
}
func (a *App) ExportSession(id string) (string, error) {
	payload, err := a.sessionStore.Export(id)
	return string(payload), err
}
func (a *App) ImportSession(path, source string) (Session, error) {
	summary, err := a.sessionStore.Import(path, source)
	if err != nil {
		return Session{}, err
	}
	return sessionFromSummary(summary), nil
}

func sessionFromSummary(summary sessions.Summary) Session {
	return Session{ID: summary.ID, Title: summary.Title, CWD: summary.CWD, Model: summary.Model, Messages: summary.Messages, Created: summary.Created, Updated: summary.Updated, Category: summary.Category, Favorite: summary.Favorite, Usage: fromSessionUsage(summary.Usage)}
}

func fromSessionUsage(value sessions.TokenUsage) TokenUsage {
	return TokenUsage{Input: value.Input, Output: value.Output, CacheRead: value.CacheRead, CacheWrite: value.CacheWrite, Cached: value.Cached(), Total: value.Input + value.Output + value.Cached()}
}

func fromCounters(value usage.Counters) TokenUsage {
	return TokenUsage{Input: value.Input, Output: value.Output, CacheRead: value.CacheRead, CacheWrite: value.CacheWrite, Cached: value.Cached(), Total: value.Total()}
}

func (a *App) GetUsageStats(sessionID, model string) (UsageStats, error) {
	if model == "" {
		model = a.GetDefaultModel()
	}
	total, err := usage.ReadAggregate(filepath.Join(a.rickConfigDir(), "usage.json"))
	if err != nil {
		return UsageStats{}, err
	}
	sessionStats, err := usage.ReadSessionStats(a.sessionStore.Dir(), sessionID)
	if err != nil {
		return UsageStats{}, err
	}
	contextLimit := usage.ResolveContextWindow(filepath.Join(a.rickConfigDir(), "auth.json"), model)
	// The daemon's advertised window (rickserve /models) is authoritative: it
	// applies provider-specific overrides the raw auth.json parse cannot see.
	if advertised, ok := a.advertisedContextWindow(model); ok {
		contextLimit = advertised
	}
	a.mu.Lock()
	lastUsage := a.lastUsage
	lastUsageSessionID := a.lastUsageSessionID
	a.mu.Unlock()
	contextUsed := sessionStats.ContextUsed
	if lastUsageSessionID == sessionID || (sessionID == "" && lastUsageSessionID == "") {
		if lastUsage.ContextTokens > 0 {
			contextUsed = lastUsage.ContextTokens
		}
		if lastUsage.ContextLimit > 0 {
			contextLimit = lastUsage.ContextLimit
		}
	}
	return UsageStats{SessionID: sessionID, Model: model, Session: fromCounters(sessionStats.Counters), Total: fromCounters(total), ContextUsed: contextUsed, ContextLimit: contextLimit, ContextKnown: contextLimit > 0 && contextUsed > 0}, nil
}

// advertisedContextWindow returns the context window rickserve advertises for
// a "provider/model" string, using the cached providers list so repeat reads
// do not spawn a fresh daemon process.
func (a *App) advertisedContextWindow(model string) (int, bool) {
	providerName, modelID, ok := strings.Cut(model, "/")
	if !ok || providerName == "" || modelID == "" {
		return 0, false
	}
	providers, err := a.GetProviders()
	if err != nil {
		return 0, false
	}
	for _, provider := range providers {
		if provider.Name != providerName {
			continue
		}
		for _, candidate := range provider.Models {
			if candidate.ID == modelID && candidate.ContextWindow > 0 {
				return candidate.ContextWindow, true
			}
		}
	}
	return 0, false
}

type DesktopConfig struct {
	SchemaVersion       int    `json:"schema_version"`
	Model               string `json:"model,omitempty"`
	Theme               string `json:"theme"`
	FontSize            string `json:"font_size"`
	PermissionProfile   string `json:"permission_profile"`
	Sandbox             string `json:"sandbox"`
	ShowReasoning       bool   `json:"show_reasoning"`
	ReasoningExpanded   bool   `json:"reasoning_expanded"`
	MaxSwarmConcurrency int    `json:"max_swarm_concurrency"`
	ThinkingMode        string `json:"thinking_mode"`
	Yolo                bool   `json:"yolo"`
	RickservePath       string `json:"rickserve_path,omitempty"`
	WorkspacePath       string `json:"workspace_path,omitempty"`
	BackgroundMode      string `json:"background_mode,omitempty"`
	BackgroundPath      string `json:"background_path,omitempty"`
	// BackgroundTransparency is 0-100; higher means more of the image shows
	// through the theme-tinted scrim.
	BackgroundTransparency int `json:"background_transparency,omitempty"`
}

func toDesktopConfig(value domain.AppConfig) DesktopConfig {
	return DesktopConfig{SchemaVersion: value.SchemaVersion, Model: value.Model, Theme: value.Theme, FontSize: value.FontSize, PermissionProfile: value.PermissionProfile, Sandbox: value.Sandbox, ShowReasoning: value.ShowReasoning, ReasoningExpanded: value.ReasoningExpanded, MaxSwarmConcurrency: value.MaxSwarmConcurrency, ThinkingMode: value.ThinkingMode, Yolo: value.Yolo, RickservePath: value.RickservePath, WorkspacePath: value.WorkspacePath, BackgroundMode: value.BackgroundMode, BackgroundPath: value.BackgroundPath, BackgroundTransparency: value.BackgroundTransparency}
}

func fromDesktopConfig(value DesktopConfig) domain.AppConfig {
	return domain.AppConfig{SchemaVersion: value.SchemaVersion, Model: value.Model, Theme: value.Theme, FontSize: value.FontSize, PermissionProfile: value.PermissionProfile, Sandbox: value.Sandbox, ShowReasoning: value.ShowReasoning, ReasoningExpanded: value.ReasoningExpanded, MaxSwarmConcurrency: value.MaxSwarmConcurrency, ThinkingMode: value.ThinkingMode, Yolo: value.Yolo, RickservePath: value.RickservePath, WorkspacePath: value.WorkspacePath, BackgroundMode: value.BackgroundMode, BackgroundPath: value.BackgroundPath, BackgroundTransparency: value.BackgroundTransparency}
}

func (a *App) GetConfig() (DesktopConfig, error) {
	value, err := a.configStore.Load()
	return toDesktopConfig(value), err
}
func (a *App) UpdateConfig(value DesktopConfig) error {
	return a.configStore.Save(fromDesktopConfig(value))
}
func (a *App) ExportSettings() (string, error) {
	value, err := a.configStore.Export()
	return string(value), err
}
func (a *App) ImportSettings(payload string) error {
	value, err := a.configStore.Import([]byte(payload))
	if err != nil {
		return err
	}
	return a.configStore.Save(value)
}
func (a *App) ResetSettings() error { return a.configStore.Reset() }

func (a *App) GetCommandCatalog() []domain.CommandSpec { return domain.DefaultCommandCatalog() }

func (a *App) ExecuteRickCommand(line string, approved bool) (commands.Result, error) {
	path, err := exec.LookPath("rick")
	if err != nil {
		return commands.Result{}, errors.New("rick executable not found in PATH")
	}
	return commands.Execute(context.Background(), line, approved, path, domain.DefaultCommandCatalog())
}

type RuntimeInfo struct {
	Version       string `json:"version"`
	RickservePath string `json:"rickserve_path"`
	SettingsPath  string `json:"settings_path"`
	SessionsPath  string `json:"sessions_path"`
	Running       bool   `json:"running"`
}

func (a *App) GetRuntimeInfo() RuntimeInfo {
	version := a.GetRickVersion()
	path, _ := a.findRickserve()
	a.mu.Lock()
	running := a.bridge != nil && a.bridge.Running()
	a.mu.Unlock()
	return RuntimeInfo{Version: version, RickservePath: path, SettingsPath: a.configStore.Path(), SessionsPath: a.sessionStore.Dir(), Running: running}
}

func (a *App) GetDefaultModel() string {
	if config, err := a.configStore.Load(); err == nil && config.Model != "" {
		return config.Model
	}
	data, err := os.ReadFile(filepath.Join(a.rickConfigDir(), "rick.json"))
	if err != nil {
		return ""
	}
	var value map[string]any
	if json.Unmarshal(data, &value) != nil {
		return ""
	}
	model, _ := value["model"].(string)
	return model
}

func (a *App) GetRickVersion() string {
	if value, ok := a.versionCache.get(); ok {
		return value
	}
	command := bridge.NewCommand("rick", "version")
	output, err := command.CombinedOutput()
	if err != nil {
		return "unknown"
	}
	version := strings.TrimSpace(string(output))
	a.versionCache.set(version)
	return version
}

// ---------- extensions ----------

// GetExtensions lists all extensions (built-in and user-added) with their
// enabled state.
func (a *App) GetExtensions() ([]extensions.Extension, error) {
	return a.extensions.List(), nil
}

// SetExtensionEnabled flips an extension's enabled flag.
func (a *App) SetExtensionEnabled(id string, enabled bool) error {
	return a.extensions.SetEnabled(id, enabled)
}

// AddExtension opens the native picker for an extension manifest (JSON) and
// registers it.
func (a *App) AddExtension() (extensions.Extension, error) {
	if a.ctx == nil {
		return extensions.Extension{}, nil
	}
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:   "Add extension manifest",
		Filters: []wailsruntime.FileFilter{{DisplayName: "Extension manifest", Pattern: "*.json"}},
	})
	if err != nil {
		return extensions.Extension{}, err
	}
	if path == "" {
		return extensions.Extension{}, errors.New("no file selected")
	}
	return a.extensions.AddUserExtension(path)
}

// RemoveExtension deletes a user-uploaded extension.
func (a *App) RemoveExtension(id string) error {
	return a.extensions.RemoveUserExtension(id)
}

// ---------- NVPN extension ----------

// NvpnGetSettings returns the stored NVPN configuration. Passwords are never
// sent to the renderer; only whether one is saved.
func (a *App) NvpnGetSettings() (nvpn.Settings, error) {
	state, err := a.extensions.NVPN()
	if err != nil {
		return nvpn.Settings{}, err
	}
	return nvpn.Settings{
		Username:    state.Username,
		HasPassword: state.Password != "",
		AutoConnect: state.AutoConnect,
		OpenVPN: nvpn.OpenVPNSettings{
			Username:    state.OpenVPNUsername,
			ConfigName:  state.OpenVPNConfigName,
			HasPassword: state.OpenVPNPassword != "",
			AutoConnect: state.OpenVPNAutoConnect,
		},
	}, nil
}

// NvpnSetCredentials saves NVPN service credentials. An empty password keeps
// the previously saved one, so the UI can leave the field blank when
// unchanged.
func (a *App) NvpnSetCredentials(username, password string) error {
	state, err := a.extensions.NVPN()
	if err != nil {
		return err
	}
	state.Username = username
	if password != "" {
		state.Password = password
	}
	return a.extensions.SaveNVPN(state)
}

// NvpnSetAutoConnect persists the "auto connect on start" flag.
func (a *App) NvpnSetAutoConnect(autoConnect bool) error {
	state, err := a.extensions.NVPN()
	if err != nil {
		return err
	}
	state.AutoConnect = autoConnect
	return a.extensions.SaveNVPN(state)
}

// NvpnConnect connects to the fastest NordVPN server and restarts rickserve
// so its traffic (provider API requests) is routed through the tunnel.
func (a *App) NvpnConnect() (nvpn.Status, error) {
	if err := a.openvpn.Stop(); err != nil {
		return nvpn.Status{}, err
	}
	state, err := a.extensions.NVPN()
	if err != nil {
		return nvpn.Status{}, err
	}
	status, err := a.nvpn.Connect(state.Username, state.Password)
	if err != nil {
		return nvpn.Status{}, err
	}
	a.restartRickserve()
	return status, nil
}

// NvpnStop disconnects the tunnel and restores direct traffic.
func (a *App) NvpnStop() error {
	if err := a.nvpn.Stop(); err != nil {
		return err
	}
	a.restartRickserve()
	return nil
}

// NvpnReconnect bounces the tunnel to the fastest server.
func (a *App) NvpnReconnect() (nvpn.Status, error) {
	if err := a.openvpn.Stop(); err != nil {
		return nvpn.Status{}, err
	}
	state, err := a.extensions.NVPN()
	if err != nil {
		return nvpn.Status{}, err
	}
	status, err := a.nvpn.Reconnect(state.Username, state.Password)
	if err != nil {
		return nvpn.Status{}, err
	}
	a.restartRickserve()
	return status, nil
}

// ---------- OpenVPN mode ----------

// NvpnImportOpenvpnConfig opens the native picker for a .ovpn profile and
// sanitizes it into a strict split tunnel (only provider API routes pinned).
func (a *App) NvpnImportOpenvpnConfig() (nvpn.ImportResult, error) {
	if a.ctx == nil {
		return nvpn.ImportResult{}, nil
	}
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:   "Import OpenVPN config",
		Filters: []wailsruntime.FileFilter{{DisplayName: "OpenVPN config", Pattern: "*.ovpn;*.conf"}},
	})
	if err != nil {
		return nvpn.ImportResult{}, err
	}
	if path == "" {
		return nvpn.ImportResult{}, errors.New("no file selected")
	}
	result, err := a.openvpn.ImportConfig(path)
	if err != nil {
		return nvpn.ImportResult{}, err
	}
	state, err := a.extensions.NVPN()
	if err != nil {
		return result, err
	}
	state.OpenVPNConfigName = result.ConfigName
	if err := a.extensions.SaveNVPN(state); err != nil {
		return result, err
	}
	return result, nil
}

// NvpnSetOpenvpnCredentials saves the OpenVPN/IKEv2 credentials. An empty
// password keeps the previously saved one.
func (a *App) NvpnSetOpenvpnCredentials(username, password string) error {
	state, err := a.extensions.NVPN()
	if err != nil {
		return err
	}
	state.OpenVPNUsername = username
	if password != "" {
		state.OpenVPNPassword = password
	}
	return a.extensions.SaveNVPN(state)
}

// NvpnSetOpenvpnAutoConnect persists the "auto connect on start" flag for
// OpenVPN mode.
func (a *App) NvpnSetOpenvpnAutoConnect(autoConnect bool) error {
	state, err := a.extensions.NVPN()
	if err != nil {
		return err
	}
	state.OpenVPNAutoConnect = autoConnect
	return a.extensions.SaveNVPN(state)
}

// NvpnConnectOpenvpn connects the imported profile with the given credentials
// (saving them for auto-connect) and restarts rickserve through the tunnel.
func (a *App) NvpnConnectOpenvpn(username, password string) (nvpn.Status, error) {
	if err := a.nvpn.Stop(); err != nil {
		return nvpn.Status{}, err
	}
	state, err := a.extensions.NVPN()
	if err != nil {
		return nvpn.Status{}, err
	}
	state.OpenVPNUsername = username
	if password != "" {
		state.OpenVPNPassword = password
	}
	if err := a.extensions.SaveNVPN(state); err != nil {
		return nvpn.Status{}, err
	}
	status, err := a.openvpn.Connect(username, password)
	if err != nil {
		return nvpn.Status{}, err
	}
	a.restartRickserve()
	return status, nil
}

// NvpnStopOpenvpn disconnects the tunnel and restores direct traffic.
func (a *App) NvpnStopOpenvpn() error {
	if err := a.openvpn.Stop(); err != nil {
		return err
	}
	a.restartRickserve()
	return nil
}

// NvpnReconnectOpenvpn bounces the OpenVPN tunnel.
func (a *App) NvpnReconnectOpenvpn() (nvpn.Status, error) {
	if err := a.nvpn.Stop(); err != nil {
		return nvpn.Status{}, err
	}
	state, err := a.extensions.NVPN()
	if err != nil {
		return nvpn.Status{}, err
	}
	status, err := a.openvpn.Connect(state.OpenVPNUsername, state.OpenVPNPassword)
	if err != nil {
		return nvpn.Status{}, err
	}
	a.restartRickserve()
	return status, nil
}

// NvpnStatus returns the active tunnel state (SOCKS5 or OpenVPN).
func (a *App) NvpnStatus() nvpn.Status {
	if socks := a.nvpn.Status(); socks.Connected {
		return socks
	}
	return a.openvpn.Status()
}

// PickFolder opens the native directory picker and returns the selected path,
// or "" when the user cancels.
func (a *App) PickFolder() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{Title: "Select workspace folder"})
}

// PickBackgroundFile opens the native file picker for a custom app background
// image and returns the selected path, or "" when the user cancels.
func (a *App) PickBackgroundFile() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	filter := wailsruntime.FileFilter{DisplayName: "Image files", Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp"}
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:   "Select background image",
		Filters: []wailsruntime.FileFilter{filter},
	})
}

// maxBackgroundBytes keeps background media reasonable; files larger than
// this are rejected with a clear message.
const maxBackgroundBytes = 80 << 20 // 80 MB

// backgroundHandler serves the configured custom background image as a normal
// resource on the wails:// scheme. file:// paths are blocked cross-origin, so
// the file must be streamed by the backend. http.ServeContent provides the
// cache/range handling for <img>.
func (a *App) backgroundHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__background" {
			http.NotFound(w, r)
			return
		}
		value, err := a.configStore.Load()
		if err != nil || value.BackgroundMode == "" || value.BackgroundMode == "theme" || strings.TrimSpace(value.BackgroundPath) == "" {
			http.NotFound(w, r)
			return
		}
		file, err := os.Open(value.BackgroundPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if info.Size() > maxBackgroundBytes {
			http.Error(w, "background file is larger than 80 MB", http.StatusRequestEntityTooLarge)
			return
		}
		// http.ServeContent only sniffs the type when the header is unset;
		// set it from the extension so images decode instead of downloading.
		w.Header().Set("Content-Type", backgroundMime(value.BackgroundPath))
		// Revalidate on every load so replacing the file or switching modes is
		// picked up immediately; ServeContent turns that into cheap 304s.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, filepath.Base(value.BackgroundPath), info.ModTime(), file)
	})
}

func backgroundMime(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	default:
		return "application/octet-stream"
	}
}

func (a *App) desktopSettingsPath() string {
	return filepath.Join(a.rickConfigDir(), "desktop.json")
}
func (a *App) rickConfigDir() string {
	if value := os.Getenv("APPDATA"); value != "" {
		return filepath.Join(value, "rick")
	}
	if value, err := os.UserConfigDir(); err == nil {
		return filepath.Join(value, "rick")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "rick")
}
func (a *App) sessionsPath() string {
	if value := os.Getenv("LOCALAPPDATA"); value != "" {
		return filepath.Join(value, "rick", "sessions")
	}
	if value, err := os.UserCacheDir(); err == nil {
		return filepath.Join(value, "rick", "sessions")
	}
	return filepath.Join(a.rickConfigDir(), "sessions")
}
