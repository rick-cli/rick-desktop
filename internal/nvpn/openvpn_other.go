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

func killProcess(_ int) bool { return true }

func killProcessElevated(_ int) {}
