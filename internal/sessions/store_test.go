package sessions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeFixture(t *testing.T, dir string) {
	t.Helper()
	payload := map[string]any{
		"id": "session-1", "title": "Fix tests", "cwd": "G:\\RickDesktop", "model": "provider/model",
		"created": "2026-08-03T01:00:00Z", "updated": "2026-08-03T02:00:00Z",
		"messages": []any{
			map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "Fix tests"}}},
			map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "Done"}}},
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
	if summaries[0].Messages != 2 || summaries[0].Title != "Fix tests" {
		t.Fatalf("unexpected summary: %+v", summaries[0])
	}
	messages, err := store.Messages("session-1")
	if err != nil || len(messages) != 2 || messages[1].Content != "Done" {
		t.Fatalf("messages = %#v, err = %v", messages, err)
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
