//go:build !windows

package main

import "syscall"

// detachedSysProcAttr starts the updater in its own process group so it is
// not torn down when the app process exits.
func detachedSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}