package usage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadAggregateUsesLifetimeTotals(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	payload := `{"2026-01-01":{"provider/model":{"days":{"2026-01-01":{"input":3,"output":4,"cache_read":5,"cache_write":6}},"total":{"input":30,"output":40,"cache_read":50,"cache_write":60}}}}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := ReadAggregate(path)
	if err != nil {
		t.Fatal(err)
	}
	want := Counters{Input: 30, Output: 40, CacheRead: 50, CacheWrite: 60}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestCountersTotalIncludesCachedTokens(t *testing.T) {
	value := Counters{Input: 14_200_000, Output: 2_800_000, CacheRead: 161_900_000}
	if got, want := value.Total(), 178_900_000; got != want {
		t.Fatalf("got total %d, want %d", got, want)
	}
}

func TestResolveContextWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	payload := `{"provider":{"openai":{"context_windows":{"gpt-5":128000}}}}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ResolveContextWindow(path, "openai/gpt-5"); got != 128000 {
		t.Fatalf("got %d, want 128000", got)
	}
}

func TestReadDailyBucketsByDayAndModel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	payload := `{"2026-01-01":{"provider/alpha":{"days":{"2026-01-01":{"input":10,"output":5,"cache_read":7,"cache_write":0}}},"provider/beta":{"days":{"2026-01-01":{"input":1,"output":2,"cache_read":0,"cache_write":0},"2026-01-02":{"input":3,"output":4,"cache_read":0,"cache_write":0}}}}}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	daily, err := ReadDaily(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != 2 {
		t.Fatalf("got %d days, want 2", len(daily))
	}
	first := daily["2026-01-01"]
	if first["provider/alpha"] != (Counters{Input: 10, Output: 5, CacheRead: 7}) {
		t.Fatalf("unexpected alpha counters: %+v", first["provider/alpha"])
	}
	if first["provider/beta"] != (Counters{Input: 1, Output: 2}) {
		t.Fatalf("unexpected beta counters: %+v", first["provider/beta"])
	}
	if daily["2026-01-02"]["provider/beta"] != (Counters{Input: 3, Output: 4}) {
		t.Fatalf("unexpected second-day beta counters: %+v", daily["2026-01-02"]["provider/beta"])
	}
}

func TestReadDailyMissingFile(t *testing.T) {
	daily, err := ReadDaily(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != 0 {
		t.Fatalf("expected empty daily map, got %v", daily)
	}
}
