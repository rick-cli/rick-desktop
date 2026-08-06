package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"rickdesktop/internal/domain"
)

type Store struct {
	path string
}

func NewStore(path string) *Store {
	return &Store{path: path}
}

func (s *Store) Path() string { return s.path }

func (s *Store) Load() (domain.AppConfig, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return domain.DefaultConfig(), nil
	}
	if err != nil {
		return domain.AppConfig{}, fmt.Errorf("read desktop settings: %w", err)
	}
	config, err := decodeConfig(data)
	if err != nil {
		return domain.AppConfig{}, err
	}
	return config, nil
}

func (s *Store) Save(config domain.AppConfig) error {
	config = withDefaults(config)
	if validationErrors := Validate(config); len(validationErrors) > 0 {
		return fmt.Errorf("validate desktop settings: %s", strings.Join(validationErrors, "; "))
	}
	payload, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encode desktop settings: %w", err)
	}
	payload = append(payload, '\n')

	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return fmt.Errorf("create desktop settings directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".settings-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary settings file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("protect temporary settings file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write temporary settings file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync temporary settings file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary settings file: %w", err)
	}

	backupPath := s.path + ".bak"
	if _, err := os.Stat(s.path); err == nil {
		_ = os.Remove(backupPath)
		if err := os.Rename(s.path, backupPath); err != nil {
			return fmt.Errorf("backup desktop settings: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect desktop settings: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		if _, backupErr := os.Stat(backupPath); backupErr == nil {
			_ = os.Rename(backupPath, s.path)
		}
		return fmt.Errorf("replace desktop settings: %w", err)
	}
	return nil
}

func (s *Store) Reset() error {
	return s.Save(domain.DefaultConfig())
}

func (s *Store) Export() ([]byte, error) {
	config, err := s.Load()
	if err != nil {
		return nil, err
	}
	payload, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("export desktop settings: %w", err)
	}
	return append(payload, '\n'), nil
}

func (s *Store) Import(payload []byte) (domain.AppConfig, error) {
	if containsSecretField(payload) {
		return domain.AppConfig{}, errors.New("secret fields are not accepted in Desktop settings imports")
	}
	config, err := decodeConfig(payload)
	if err != nil {
		return domain.AppConfig{}, err
	}
	if validationErrors := Validate(config); len(validationErrors) > 0 {
		return domain.AppConfig{}, fmt.Errorf("validate imported settings: %s", strings.Join(validationErrors, "; "))
	}
	return config, nil
}

func Validate(config domain.AppConfig) []string {
	var problems []string
	switch config.Theme {
	case "charcoal", "graphite", "midnight", "dracula", "nord", "gruvbox", "github-dark", "tokyo-night", "catppuccin", "one-dark", "solarized-dark", "light", "system", "dark":
	default:
		problems = append(problems, "theme must be a supported palette name")
	}
	switch config.FontSize {
	case "small", "medium", "large":
	default:
		problems = append(problems, "font_size must be small, medium, or large")
	}
	switch config.PermissionProfile {
	case "readonly", "standard", "trusted", "ci":
	default:
		problems = append(problems, "permission_profile must be readonly, standard, trusted, or ci")
	}
	switch config.Sandbox {
	case "read-only", "workspace-write", "trusted", "off":
	default:
		problems = append(problems, "sandbox must be read-only, workspace-write, trusted, or off")
	}
	switch config.ThinkingMode {
	case "auto", "off", "on", "minimal", "low", "medium", "high", "xhigh", "max":
	default:
		problems = append(problems, "thinking_mode must be auto, off, on, minimal, low, medium, high, xhigh, or max")
	}
	if config.MaxSwarmConcurrency < 1 || config.MaxSwarmConcurrency > 32 {
		problems = append(problems, "max_swarm_concurrency must be between 1 and 32")
	}
	if len(config.Model) > 256 {
		problems = append(problems, "model is too long")
	}
	return problems
}

func decodeConfig(payload []byte) (domain.AppConfig, error) {
	config := domain.DefaultConfig()
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&config); err != nil {
		return domain.AppConfig{}, fmt.Errorf("decode desktop settings: %w", err)
	}
	if config.SchemaVersion == 0 {
		config.SchemaVersion = 1
	}
	config = withDefaults(config)
	if validationErrors := Validate(config); len(validationErrors) > 0 {
		return domain.AppConfig{}, fmt.Errorf("validate desktop settings: %s", strings.Join(validationErrors, "; "))
	}
	return config, nil
}

func withDefaults(config domain.AppConfig) domain.AppConfig {
	defaults := domain.DefaultConfig()
	if config.SchemaVersion < defaults.SchemaVersion {
		if config.SchemaVersion == 1 && config.Theme == "charcoal" {
			config.Theme = defaults.Theme
		}
		config.SchemaVersion = defaults.SchemaVersion
	}
	if config.Theme == "" {
		config.Theme = defaults.Theme
	} else if config.Theme == "dark" {
		config.Theme = "charcoal"
	}
	if config.FontSize == "" {
		config.FontSize = defaults.FontSize
	}
	if config.PermissionProfile == "" {
		config.PermissionProfile = defaults.PermissionProfile
	}
	if config.Sandbox == "" {
		config.Sandbox = defaults.Sandbox
	}
	if config.MaxSwarmConcurrency == 0 {
		config.MaxSwarmConcurrency = defaults.MaxSwarmConcurrency
	}
	if config.ThinkingMode == "" {
		config.ThinkingMode = defaults.ThinkingMode
	}
	return config
}

func containsSecretField(payload []byte) bool {
	var value any
	if json.Unmarshal(payload, &value) != nil {
		return false
	}
	return containsSecretValue(value)
}

func containsSecretValue(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
			for _, marker := range []string{"secret", "token", "password", "credential", "api_key", "apikey"} {
				if strings.Contains(normalized, marker) {
					return true
				}
			}
			if containsSecretValue(nested) {
				return true
			}
		}
	case []any:
		for _, nested := range typed {
			if containsSecretValue(nested) {
				return true
			}
		}
	}
	return false
}
