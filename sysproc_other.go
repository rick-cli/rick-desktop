//go:build !windows

package main

import "syscall"

// hiddenSysProcAttr is only meaningful on Windows (CREATE_NO_WINDOW); the
// non-Windows updater uses detachedSysProcAttr instead, so this is a no-op
// kept for cross-platform compilation of runDetached.
func hiddenSysProcAttr() *syscall.SysProcAttr {
	return nil
}

// detachedSysProcAttr starts the updater in its own process group so it is
// not torn down when the app process exits.
func detachedSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
