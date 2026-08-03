//go:build !windows

package bridge

import (
	"context"
	"os/exec"
)

func newCommand(path string, args ...string) *exec.Cmd {
	return exec.Command(path, args...)
}

func newContextCommand(ctx context.Context, path string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, path, args...)
}

func NewCommand(path string, args ...string) *exec.Cmd { return newCommand(path, args...) }
func NewCommandContext(ctx context.Context, path string, args ...string) *exec.Cmd {
	return newContextCommand(ctx, path, args...)
}
