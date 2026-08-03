//go:build windows

package commands

import (
	"context"
	"os/exec"
	"syscall"
)

// createNoWindow keeps rick subprocesses from flashing console windows on
// Windows (CREATE_NO_WINDOW).
const createNoWindow = 0x08000000

func newCommandContext(ctx context.Context, path string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, path, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return command
}
