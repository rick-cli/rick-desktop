package sessions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeFixture(t *testing.T, dir string) {
	t.Helper()
	payload := map[string]any{
		"id": "session-1", "title": "Fix tests", "cwd": "G:\\RickDesktop", "model": "provider/model",
		"created": "2026-08-03T01:00:00Z", "updated": "2026-08-03T02:00:00Z",
		"messages": []any{
			map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "Fix tests"}}},
			map[string]any{"role": "assistant", "content": []any{
				map[string]any{"type": "thinking", "text": "Inspect the failure"},
				map[string]any{"type": "tool_use", "id": "tool-1", "name": "read", "input": map[string]any{"path": "main.go"}},
				map[string]any{"type": "text", "text": "Done"},
			}},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "tool_result", "tool_use_id": "tool-1", "content": "package main", "is_error": false},
			}},
		},
	}
	data, _ := json.Marshal(payload)
	if err := os.WriteFile(filepath.Join(dir, "session-1.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir, err := os.MkdirTemp(`C:\Users\einme\AppData\Local\Temp`, "rickdesktop-sessions-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	writeFixture(t, dir)
	return NewStore(dir)
}

func TestListAndReadNormalizeSessionFiles(t *testing.T) {
	store := newTestStore(t)
	summaries, err := store.List()
	if err != nil || len(summaries) != 1 {
		t.Fatalf("list = %#v, err = %v", summaries, err)
	}
	if summaries[0].Messages != 3 || summaries[0].Title != "Fix tests" {
		t.Fatalf("unexpected summary: %+v", summaries[0])
	}
	messages, err := store.Messages("session-1")
	if err != nil || len(messages) != 3 || messages[1].Content != "Done" {
		t.Fatalf("messages = %#v, err = %v", messages, err)
	}
	if len(messages[1].Blocks) != 3 || messages[1].Blocks[0].Type != "thinking" || messages[1].Blocks[1].Name != "read" {
		t.Fatalf("assistant blocks were flattened: %#v", messages[1].Blocks)
	}
	if got := messages[2].Blocks[0]; got.Type != "tool_result" || got.ToolUseID != "tool-1" || got.Content != "package main" {
		t.Fatalf("tool result was not preserved: %#v", got)
	}
}

func TestListAutoCategoriesMetaSessionsByDate(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().Format(time.RFC3339Nano)
	meta := map[string]any{
		"id": "desk-today", "title": "Fresh thread", "cwd": "C:\\work", "model": "p/m",
		"created": now, "updated": now, "messages": 1,
	}
	data, _ := json.Marshal(meta)
	if err := os.WriteFile(filepath.Join(store.dir, "desk-today.meta.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	meta["id"] = "desk-custom"
	meta["category"] = "My project"
	custom, _ := json.Marshal(meta)
	if err := os.WriteFile(filepath.Join(store.dir, "desk-custom.meta.json"), custom, 0600); err != nil {
		t.Fatal(err)
	}

	summaries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	categories := map[string]string{}
	for _, summary := range summaries {
		categories[summary.ID] = summary.Category
	}
	if categories["desk-today"] != "Today" {
		t.Fatalf("fresh meta session should bucket as Today, got %q", categories["desk-today"])
	}
	if categories["desk-custom"] != "My project" {
		t.Fatalf("explicit category should be preserved, got %q", categories["desk-custom"])
	}
}

func TestRenameForkSearchAndExport(t *testing.T) {
	store := newTestStore(t)
	if err := store.Rename("session-1", "Renamed"); err != nil {
		t.Fatal(err)
	}
	fork, err := store.Fork("session-1")
	if err != nil {
		t.Fatal(err)
	}
	if fork.ID == "session-1" || fork.Title == "" {
		t.Fatalf("unexpected fork: %+v", fork)
	}
	results, err := store.Search("renamed")
	if err != nil || len(results) != 2 {
		t.Fatalf("search = %#v, err = %v", results, err)
	}
	exported, err := store.Export("session-1")
	if err != nil || len(exported) == 0 {
		t.Fatalf("export length/error = %d/%v", len(exported), err)
	}
}
