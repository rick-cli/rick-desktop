package timelinecache

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxTimelineBytes = 32 << 20

// Store persists Desktop's rich per-session timeline separately from rick's
// canonical provider transcript. It protects in-flight prompts and formatted
// event blocks across chat switches and process restarts.
type Store struct {
	dir string
}

func New(dir string) *Store { return &Store{dir: dir} }

func (s *Store) Save(sessionID string, payload []byte) error {
	if !validSessionID(sessionID) {
		return errors.New("invalid session identifier")
	}
	if len(payload) == 0 || len(payload) > maxTimelineBytes || !json.Valid(payload) {
		return errors.New("invalid timeline payload")
	}
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return fmt.Errorf("create desktop timeline directory: %w", err)
	}
	path := filepath.Join(s.dir, sessionID+".json")
	temporary, err := os.CreateTemp(s.dir, ".timeline-*.tmp")
	if err != nil {
		return fmt.Errorf("create desktop timeline: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write desktop timeline: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync desktop timeline: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close desktop timeline: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("save desktop timeline: %w", err)
	}
	return nil
}

func (s *Store) Load(sessionID string) ([]byte, error) {
	if !validSessionID(sessionID) {
		return nil, errors.New("invalid session identifier")
	}
	payload, err := os.ReadFile(filepath.Join(s.dir, sessionID+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read desktop timeline: %w", err)
	}
	payload = bytes.TrimSpace(payload)
	if len(payload) == 0 || len(payload) > maxTimelineBytes || !json.Valid(payload) {
		return nil, errors.New("desktop timeline is corrupt")
	}
	return payload, nil
}

func (s *Store) Delete(sessionID string) error {
	if !validSessionID(sessionID) {
		return errors.New("invalid session identifier")
	}
	err := os.Remove(filepath.Join(s.dir, sessionID+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *Store) List() (map[string][]byte, error) {
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		return map[string][]byte{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list desktop timelines: %w", err)
	}
	result := make(map[string][]byte, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		sessionID := strings.TrimSuffix(entry.Name(), ".json")
		if !validSessionID(sessionID) {
			continue
		}
		payload, loadErr := s.Load(sessionID)
		if loadErr == nil && payload != nil {
			result[sessionID] = payload
		}
	}
	return result, nil
}

func validSessionID(value string) bool {
	if value == "" || value == "." || value == ".." || strings.ContainsAny(value, `/\\`) {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			continue
		}
		return false
	}
	return true
}
