// Package extensions manages the desktop's extension registry: built-in
// extensions shipped with the app plus user-uploaded manifests, each with an
// enabled/disabled flag. Extension-specific settings (e.g. NVPN credentials)
// are stored alongside in the same JSON file.
package extensions

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// Extension describes one extension shown in the Settings -> Extensions tab.
type Extension struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version,omitempty"`
	BuiltIn     bool   `json:"built_in"`
	Enabled     bool   `json:"enabled"`
	Source      string `json:"source"`
}

// UserExtension is a manifest uploaded by the user.
type UserExtension struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version,omitempty"`
}

// NVPNState holds the NVPN extension's persisted settings. The password is
// stored so "auto connect on start" can reconnect without re-prompting.
type NVPNState struct {
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	AutoConnect bool   `json:"auto_connect"`

	OpenVPNConfigName   string `json:"openvpn_config_name,omitempty"`
	OpenVPNUsername     string `json:"openvpn_username,omitempty"`
	OpenVPNPassword     string `json:"openvpn_password,omitempty"`
	OpenVPNAutoConnect  bool   `json:"openvpn_auto_connect"`
}

// State is the on-disk shape of the registry file.
type State struct {
	Enabled map[string]bool `json:"enabled,omitempty"`
	User    []UserExtension `json:"user,omitempty"`
	NVPN    NVPNState       `json:"nvpn,omitempty"`
}

// BuiltinNVPN is the compiled-in NVPN extension.
var BuiltinNVPN = Extension{
	ID:          "nvpn",
	Name:        "NVPN",
	Description: "Route Rick Desktop's provider API traffic through NordVPN's SOCKS5 proxy. Adds a NVPN tab with connect/stop/reconnect and exit-IP display.",
	Version:     "1.0.0",
	BuiltIn:     true,
	Source:      "builtin",
}

// Registry loads and persists extension state.
type Registry struct {
	mu    sync.Mutex
	path  string
	state State
}

var validID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// NewRegistry loads the registry from path; a missing file starts empty.
func NewRegistry(path string) (*Registry, error) {
	registry := &Registry{path: path, state: State{Enabled: map[string]bool{}}}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &registry.state); err != nil {
			return nil, fmt.Errorf("decode extensions registry: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read extensions registry: %w", err)
	}
	if registry.state.Enabled == nil {
		registry.state.Enabled = map[string]bool{}
	}
	return registry, nil
}

// List returns built-in plus user extensions in display order.
func (r *Registry) List() []Extension {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []Extension{}
	result = append(result, r.builtinLocked())
	for _, user := range r.state.User {
		result = append(result, Extension{
			ID:          user.ID,
			Name:        user.Name,
			Description: user.Description,
			Version:     user.Version,
			BuiltIn:     false,
			Enabled:     r.state.Enabled[user.ID],
			Source:      "user",
		})
	}
	return result
}

// Enabled reports whether the named extension is enabled.
func (r *Registry) Enabled(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id == BuiltinNVPN.ID {
		return r.state.Enabled[id]
	}
	for _, user := range r.state.User {
		if user.ID == id {
			return r.state.Enabled[id]
		}
	}
	return false
}

func (r *Registry) builtinLocked() Extension {
	extension := BuiltinNVPN
	extension.Enabled = r.state.Enabled[extension.ID]
	return extension
}

// SetEnabled flips an extension's enabled flag.
func (r *Registry) SetEnabled(id string, enabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.state.Enabled[id] = enabled
	return r.saveLocked()
}

// AddUserExtension copies a manifest file (from the native picker) into the
// registry and returns the resulting Extension.
func (r *Registry) AddUserExtension(manifestPath string) (Extension, error) {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return Extension{}, fmt.Errorf("read extension manifest: %w", err)
	}
	var manifest UserExtension
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Extension{}, fmt.Errorf("invalid extension manifest (expected JSON): %w", err)
	}
	if !validID.MatchString(manifest.ID) {
		return Extension{}, errors.New("extension id must be 1-64 letters, digits, '-' or '_'")
	}
	if strings.TrimSpace(manifest.Name) == "" {
		return Extension{}, errors.New("extension manifest is missing a name")
	}
	if manifest.ID == BuiltinNVPN.ID {
		return Extension{}, errors.New("extension id collides with a built-in extension")
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.state.User {
		if existing.ID == manifest.ID {
			return Extension{}, fmt.Errorf("extension %q already added", manifest.ID)
		}
	}
	r.state.User = append(r.state.User, manifest)
	if err := r.saveLocked(); err != nil {
		return Extension{}, err
	}
	return Extension{
		ID:          manifest.ID,
		Name:        manifest.Name,
		Description: manifest.Description,
		Version:     manifest.Version,
		BuiltIn:     false,
		Enabled:     true,
		Source:      "user",
	}, nil
}

// RemoveUserExtension deletes a user-uploaded extension.
func (r *Registry) RemoveUserExtension(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := r.state.User[:0]
	found := false
	for _, user := range r.state.User {
		if user.ID == id {
			found = true
			continue
		}
		filtered = append(filtered, user)
	}
	if !found {
		return fmt.Errorf("extension %q not found", id)
	}
	r.state.User = filtered
	delete(r.state.Enabled, id)
	return r.saveLocked()
}

// NVPN returns the NVPN extension's stored settings.
func (r *Registry) NVPN() (NVPNState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.state.NVPN, nil
}

// SaveNVPN persists the NVPN extension's settings.
func (r *Registry) SaveNVPN(state NVPNState) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.state.NVPN = state
	return r.saveLocked()
}

func (r *Registry) saveLocked() error {
	payload, err := json.MarshalIndent(r.state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode extensions registry: %w", err)
	}
	payload = append(payload, '\n')
	if err := os.MkdirAll(filepath.Dir(r.path), 0700); err != nil {
		return fmt.Errorf("create extensions directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(r.path), ".extensions-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary registry file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("protect registry file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write registry file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close registry file: %w", err)
	}
	if err := os.Rename(temporaryPath, r.path); err != nil {
		return fmt.Errorf("replace registry file: %w", err)
	}
	return nil
}
