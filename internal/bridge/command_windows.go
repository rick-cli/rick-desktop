//go:build windows

package bridge

import (
	"context"
	"os/exec"
	"syscall"
)

// createNoWindow keeps rick subprocesses from flashing console windows on
// Windows (CREATE_NO_WINDOW).
const createNoWindow = 0x08000000

func newCommand(path string, args ...string) *exec.Cmd {
	command := exec.Command(path, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return command
}

func newContextCommand(ctx context.Context, path string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, path, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return command
}

func NewCommand(path string, args ...string) *exec.Cmd { return newCommand(path, args...) }
func NewCommandContext(ctx context.Context, path string, args ...string) *exec.Cmd {
	return newContextCommand(ctx, path, args...)
}
