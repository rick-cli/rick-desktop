//go:build windows

package main

import "syscall"

// hiddenSysProcAttr keeps spawned helper processes (e.g. the update script)
// from flashing a console window on Windows (CREATE_NO_WINDOW).
func hiddenSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

// detachedSysProcAttr is used by the non-Windows updater path; on Windows the
// updater already runs hidden and detached via its own process, so this is
// the same as hiddenSysProcAttr.
func detachedSysProcAttr() *syscall.SysProcAttr {
	return hiddenSysProcAttr()
}
