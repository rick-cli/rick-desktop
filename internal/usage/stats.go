package usage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Counters struct {
	Input      int `json:"input"`
	Output     int `json:"output"`
	CacheRead  int `json:"cache_read"`
	CacheWrite int `json:"cache_write"`
}

func (c Counters) Cached() int { return c.CacheRead + c.CacheWrite }
func (c Counters) Total() int  { return c.Input + c.Output + c.Cached() }

func Add(target *Counters, value Counters) {
	target.Input += value.Input
	target.Output += value.Output
	target.CacheRead += value.CacheRead
	target.CacheWrite += value.CacheWrite
}

func ReadSession(dir, id string) (Counters, error) {
	if strings.TrimSpace(id) == "" {
		return Counters{}, nil
	}
	if strings.ContainsAny(id, `/\\`) || id == "." || id == ".." {
		return Counters{}, errors.New("invalid session identifier")
	}
	payload, err := os.ReadFile(filepath.Join(dir, id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return Counters{}, nil
	}
	if err != nil {
		return Counters{}, fmt.Errorf("read session usage: %w", err)
	}
	var value struct {
		Usage Counters `json:"usage"`
	}
	if err := json.Unmarshal(payload, &value); err != nil {
		return Counters{}, fmt.Errorf("decode session usage: %w", err)
	}
	return value.Usage, nil
}

// ReadAggregate reads Rick's canonical usage.json. Rick keeps both daily and
// lifetime values; only lifetime values are added so totals are not doubled.
func ReadAggregate(path string) (Counters, error) {
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Counters{}, nil
	}
	if err != nil {
		return Counters{}, fmt.Errorf("read Rick usage: %w", err)
	}
	var root map[string]map[string]struct {
		Total Counters `json:"total"`
	}
	if err := json.Unmarshal(payload, &root); err != nil {
		return Counters{}, fmt.Errorf("decode Rick usage: %w", err)
	}
	var total Counters
	for _, providers := range root {
		for _, model := range providers {
			Add(&total, model.Total)
		}
	}
	return total, nil
}

// ReadDaily parses Rick's canonical usage.json into per-day, per-model
// counters. Rick buckets entries by day under each model's "days" map, so
// the day keys inside the map are authoritative.
func ReadDaily(path string) (map[string]map[string]Counters, error) {
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]map[string]Counters{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read Rick usage: %w", err)
	}
	var root map[string]map[string]struct {
		Days map[string]Counters `json:"days"`
	}
	if err := json.Unmarshal(payload, &root); err != nil {
		return nil, fmt.Errorf("decode Rick usage: %w", err)
	}
	daily := map[string]map[string]Counters{}
	for _, models := range root {
		for model, entry := range models {
			for date, counters := range entry.Days {
				if daily[date] == nil {
					daily[date] = map[string]Counters{}
				}
				merged := daily[date][model]
				Add(&merged, counters)
				daily[date][model] = merged
			}
		}
	}
	return daily, nil
}

func ResolveContextWindow(authPath, model string) int {
	providerName, modelID, ok := strings.Cut(model, "/")
	if !ok || providerName == "" || modelID == "" {
		return 0
	}
	payload, err := os.ReadFile(authPath)
	if err != nil {
		return 0
	}
	var value struct {
		Provider map[string]struct {
			ContextWindows map[string]int `json:"context_windows"`
		} `json:"provider"`
	}
	if json.Unmarshal(payload, &value) != nil {
		return 0
	}
	provider, ok := value.Provider[providerName]
	if !ok {
		return 0
	}
	if limit := provider.ContextWindows[modelID]; limit > 0 {
		return limit
	}
	if limit := provider.ContextWindows[model]; limit > 0 {
		return limit
	}
	return 0
}
