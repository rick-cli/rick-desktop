package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rickdesktop/internal/domain"
)

func testDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp(`C:\Users\einme\AppData\Local\Temp`, "rickdesktop-config-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func TestStoreRoundTripsAndCreatesBackup(t *testing.T) {
	path := filepath.Join(testDir(t), "settings.json")
	store := NewStore(path)
	expected := domain.DefaultConfig()
	expected.Model = "provider/model"

	if err := store.Save(expected); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Model != expected.Model || loaded.SchemaVersion != 2 || loaded.Theme != "graphite" {
		t.Fatalf("unexpected loaded config: %+v", loaded)
	}

	expected.Model = "provider/next"
	if err := store.Save(expected); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".bak"); err != nil {
		t.Fatalf("expected backup: %v", err)
	}
}

func TestValidateRejectsUnsafeOrInvalidValues(t *testing.T) {
	config := domain.DefaultConfig()
	config.PermissionProfile = "root"
	config.MaxSwarmConcurrency = 0
	errors := Validate(config)
	if len(errors) != 2 {
		t.Fatalf("expected two validation errors, got %#v", errors)
	}
}

func TestImportRejectsSecretFields(t *testing.T) {
	store := NewStore(filepath.Join(testDir(t), "settings.json"))
	_, err := store.Import([]byte(`{"model":"x","api_key":"secret"}`))
	if err == nil || !strings.Contains(err.Error(), "secret") {
		t.Fatalf("expected secret rejection, got %v", err)
	}
}
