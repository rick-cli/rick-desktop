//go:build windows

package nvpn

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

var (
	shell32           = syscall.NewLazyDLL("shell32.dll")
	procShellExecuteW = shell32.NewProc("ShellExecuteW")
)

// launchElevated starts OpenVPN through ShellExecute with "runas" so it can
// create the TUN device and add the pinned routes. A UAC prompt appears.
func launchElevated(bin string, args []string) error {
	quoted := make([]string, 0, len(args))
	for _, arg := range args {
		if strings.ContainsAny(arg, " \t") {
			quoted = append(quoted, `"`+arg+`"`)
		} else {
			quoted = append(quoted, arg)
		}
	}
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, _ := syscall.UTF16PtrFromString(bin)
	params, _ := syscall.UTF16PtrFromString(strings.Join(quoted, " "))
	result, _, err := procShellExecuteW.Call(0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		uintptr(unsafe.Pointer(params)),
		0,
		0, // SW_HIDE
	)
	if result <= 32 {
		if err != nil && err != syscall.Errno(0) {
			return fmt.Errorf("elevated launch failed: %w", err)
		}
		return errors.New("elevated launch failed (was the UAC prompt dismissed?)")
	}
	return nil
}

// findOpenVPN resolves the OpenVPN binary. Only canonical install locations
// are used; a bare PATH lookup can pick up another VPN app's bundled openvpn
// binary (e.g. Mullvad ships resources\openvpn.exe and puts it on PATH),
// which won't write our log/pid files and cannot be driven reliably.
func findOpenVPN() (string, error) {
	candidates := []string{
		`C:\Program Files\OpenVPN\bin\openvpn.exe`,
		`C:\Program Files (x86)\OpenVPN\bin\openvpn.exe`,
	}
	if path, err := exec.LookPath("openvpn"); err == nil && !strings.Contains(strings.ToLower(path), "mullvad") {
		candidates = append(candidates, path)
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", errors.New("OpenVPN client not found. Install it from https://openvpn.net (the OpenVPN Community/GUI install includes the TUN driver), then try again")
}

func processAlive(pid int) bool {
	out, err := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH").Output()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), "openvpn")
}

// firstOpenVPNPID returns the PID of the first running openvpn.exe, or 0 when
// none is running. Used to tear down a tunnel whose pid file was lost.
func firstOpenVPNPID() int {
	out, err := exec.Command("tasklist", "/FI", "IMAGENAME eq openvpn.exe", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Split(strings.Trim(line, "\r\n"), ",")
		if len(fields) >= 2 {
			if pid, err := strconv.Atoi(strings.Trim(fields[1], `"`)); err == nil && pid > 0 {
				return pid
			}
		}
	}
	return 0
}

func killProcess(pid int) bool {
	err := exec.Command("taskkill", "/F", "/PID", strconv.Itoa(pid)).Run()
	return err == nil
}

// killProcessElevated terminates an elevated OpenVPN via a UAC-bounced
// taskkill. A prompt appears once; needed because a normal-user kill is
// denied for the elevated tunnel process.
func killProcessElevated(pid int) {
	_ = exec.Command("powershell", "-Command",
		fmt.Sprintf("Start-Process taskkill -ArgumentList '/F','/PID','%d' -Verb RunAs -Wait", pid)).Run()
}
