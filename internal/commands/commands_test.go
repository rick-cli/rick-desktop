package commands

import (
	"context"
	"testing"

	"rickdesktop/internal/domain"
)

func TestParseQuotedCommand(t *testing.T) {
	parsed, err := Parse(`/exec "hello world" --format json`)
	if err != nil || parsed.Name != "exec" || len(parsed.Args) != 3 || parsed.Args[1] != "--format" {
		t.Fatalf("parsed = %#v, err = %v", parsed, err)
	}
}

func TestFindAliasAndGuardDangerousCommands(t *testing.T) {
	catalog := domain.DefaultCommandCatalog()
	spec, ok := Find(Parsed{Name: "e"}, catalog)
	if !ok || spec.Name != "exec" {
		t.Fatalf("alias lookup = %#v, %v", spec, ok)
	}
	if _, err := Execute(context.Background(), "/exec hi", false, "rick", catalog); err == nil {
		t.Fatal("expected dangerous command approval error")
	}
}
