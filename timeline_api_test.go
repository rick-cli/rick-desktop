package main

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"rickdesktop/internal/sessions"
	"rickdesktop/internal/timelinecache"
)

func TestGetSessionsIncludesUnsavedDesktopTimeline(t *testing.T) {
	root := t.TempDir()
	app := &App{
		sessionStore:  sessions.NewStore(filepath.Join(root, "sessions")),
		timelineStore: timelinecache.New(filepath.Join(root, ".rickdesktop", "timelines")),
	}
	placeholder := Session{
		ID:      "desk-live",
		Title:   "latest prompt",
		CWD:     `G:\project`,
		Model:   "provider/model",
		Created: "2026-08-06T13:00:00Z",
		Updated: "2026-08-06T13:00:00Z",
	}
	envelope := map[string]any{
		"version": 1,
		"session": placeholder,
		"timeline": map[string]any{
			"messages": []any{map[string]any{"id": "prompt", "role": "user", "done": true}},
			"loading":  true,
			"swarms":   map[string]any{},
		},
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.timelineStore.Save(placeholder.ID, payload); err != nil {
		t.Fatal(err)
	}

	listed, err := app.GetSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != placeholder.ID || listed[0].Title != placeholder.Title {
		t.Fatalf("recovered sessions = %#v", listed)
	}
}

func TestDesktopTimelineSurvivesAppRestart(t *testing.T) {
	root := t.TempDir()
	storePath := filepath.Join(root, ".rickdesktop", "timelines")
	first := &App{timelineStore: timelinecache.New(storePath)}
	payload := `{"version":1,"timeline":{"messages":[{"id":"prompt","role":"user","blocks":[{"id":"text","kind":"text","text":"latest prompt"}],"done":true}],"loading":true,"activeRunId":"run-live","swarms":{}}}`
	if err := first.SaveDesktopTimeline("desk-live", payload); err != nil {
		t.Fatal(err)
	}

	second := &App{timelineStore: timelinecache.New(storePath)}
	restored, err := second.LoadDesktopTimeline("desk-live")
	if err != nil {
		t.Fatal(err)
	}
	if restored != payload {
		t.Fatalf("restored timeline = %q, want %q", restored, payload)
	}
}
