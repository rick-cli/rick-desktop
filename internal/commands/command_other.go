//go:build !windows

package commands

import (
	"context"
	"os/exec"
)

func newCommandContext(ctx context.Context, path string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, path, args...)
}
