package extensions

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRegistryDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "extensions.json")
	registry, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	list := registry.List()
	if len(list) != 1 || list[0].ID != "nvpn" || !list[0].BuiltIn {
		t.Fatalf("expected only built-in NVPN, got %+v", list)
	}
	if registry.Enabled("nvpn") {
		t.Fatal("nvpn should start disabled")
	}
}

func TestSetEnabledPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "extensions.json")
	registry, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEnabled("nvpn", true); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.Enabled("nvpn") {
		t.Fatal("enabled state did not persist")
	}
}

func TestAddAndRemoveUserExtension(t *testing.T) {
	path := filepath.Join(t.TempDir(), "extensions.json")
	registry, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(t.TempDir(), "my-ext.json")
	content := `{"id":"my-ext","name":"My Ext","description":"Test","version":"0.1.0"}`
	if err := os.WriteFile(manifest, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	extension, err := registry.AddUserExtension(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if extension.ID != "my-ext" || extension.BuiltIn || !extension.Enabled {
		t.Fatalf("unexpected extension: %+v", extension)
	}
	if _, err := registry.AddUserExtension(manifest); err == nil {
		t.Fatal("duplicate id should be rejected")
	}
	// The first add already registered it; remove it to keep the list clean.
	if err := registry.RemoveUserExtension("my-ext"); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.AddUserExtension(manifest); err != nil {
		t.Fatal(err)
	}
	if err := registry.RemoveUserExtension("my-ext"); err != nil {
		t.Fatal(err)
	}
	if list := registry.List(); len(list) != 1 {
		t.Fatalf("expected only built-in after remove, got %d", len(list))
	}
}

func TestBuiltinIDCollisionRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "extensions.json")
	registry, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(t.TempDir(), "nvpn.json")
	content := `{"id":"nvpn","name":"Spoof","description":"x"}`
	if err := os.WriteFile(manifest, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.AddUserExtension(manifest); err == nil {
		t.Fatal("id colliding with built-in should be rejected")
	}
}

func TestInvalidManifestRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "extensions.json")
	registry, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(manifest, []byte("not json"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.AddUserExtension(manifest); err == nil {
		t.Fatal("invalid manifest should be rejected")
	}
}

func TestNVPNState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "extensions.json")
	registry, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SaveNVPN(NVPNState{Username: "u", Password: "p", AutoConnect: true}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	state, err := reloaded.NVPN()
	if err != nil {
		t.Fatal(err)
	}
	if state.Username != "u" || state.Password != "p" || !state.AutoConnect {
		t.Fatalf("unexpected nvpn state: %+v", state)
	}
}
