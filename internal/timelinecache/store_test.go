package timelinecache

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreRoundTripAndAtomicReplacement(t *testing.T) {
	store := New(t.TempDir())
	first := []byte(`{"messages":[{"role":"user","blocks":[{"kind":"text","text":"last prompt"}]}],"loading":true,"swarms":{}}`)
	second := []byte(`{"messages":[{"role":"assistant","blocks":[{"kind":"reasoning","text":"thinking"}]}],"loading":false,"swarms":{}}`)

	if err := store.Save("desk-1", first); err != nil {
		t.Fatal(err)
	}
	if err := store.Save("desk-1", second); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load("desk-1")
	if err != nil || string(loaded) != string(second) {
		t.Fatalf("loaded %q, err %v", loaded, err)
	}
	listed, err := store.List()
	if err != nil || string(listed["desk-1"]) != string(second) {
		t.Fatalf("listed %q, err %v", listed["desk-1"], err)
	}
	if err := store.Delete("desk-1"); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.Load("desk-1")
	if err != nil || loaded != nil {
		t.Fatalf("deleted timeline = %q, err %v", loaded, err)
	}
}

func TestStoreRejectsTraversalAndCorruptPayloads(t *testing.T) {
	store := New(t.TempDir())
	if err := store.Save(`..\\escape`, []byte(`{}`)); err == nil {
		t.Fatal("expected traversal identifier to fail")
	}
	if err := store.Save("desk-1", []byte(`not-json`)); err == nil {
		t.Fatal("expected invalid JSON to fail")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(store.dir), "escape.json")); !os.IsNotExist(err) {
		t.Fatalf("unexpected traversal output: %v", err)
	}
}
