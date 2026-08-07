//go:build !windows

package nvpn

import "errors"

func launchElevated(_ string, _ []string) error {
	return errors.New("openvpn mode requires Windows")
}

func findOpenVPN() (string, error) {
	return "", errors.New("openvpn mode requires Windows")
}

func processAlive(_ int) bool { return false }

// firstOpenVPNPID is only meaningful on Windows, where it lists running
// openvpn.exe processes. Non-Windows builds never reach the pid-file-less
// teardown path that calls it, so returning 0 is correct.
func firstOpenVPNPID() int { return 0 }

func killProcess(_ int) bool { return true }

func killProcessElevated(_ int) {}
