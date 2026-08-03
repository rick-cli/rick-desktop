package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed scripts/install-update.sh scripts/install-update.ps1
var updateScripts embed.FS

// UpdateInfo describes the relationship between the running build and the
// newest GitHub release, plus the exact asset to download for this platform.
type UpdateInfo struct {
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	UpdateAvailable bool   `json:"update_available"`
	AssetName       string `json:"asset_name"`
	DownloadURL     string `json:"download_url"`
	ReleaseNotes    string `json:"release_notes,omitempty"`
	CheckedAt       string `json:"checked_at"`
	Error           string `json:"error,omitempty"`
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	Body    string `json:"body"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

type updateState struct {
	mu         sync.Mutex
	last       UpdateInfo
	checking   bool
	installing bool
}

// updates holds the last-known update state so the frontend can query it
// synchronously between background checks.
var updates updateState

// portableAssetName returns the update asset name for a platform, matching
// the portable binaries produced by the release workflow. The same asset
// serves both portable runs and in-place updates.
func portableAssetName(version, goos, goarch string) string {
	base := "RickDesktop-v" + strings.TrimPrefix(version, "v") + "-" + goos + "-" + goarch
	if goos == "windows" {
		return base + ".exe"
	}
	return base
}

func (a *App) startUpdateLoop() {
	a.checkForUpdates()
	go func() {
		ticker := time.NewTicker(updateCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				a.checkForUpdates()
			case <-a.ctx.Done():
				return
			}
		}
	}()
}

// checkForUpdates queries the latest GitHub release for Rick Desktop and
// stores/emits the result. Failures are stored (not emitted as hard errors)
// so a flaky network never interrupts the app.
func (a *App) checkForUpdates() {
	updates.mu.Lock()
	if updates.checking {
		updates.mu.Unlock()
		return
	}
	updates.checking = true
	updates.mu.Unlock()

	info := a.fetchLatestRelease()

	updates.mu.Lock()
	updates.last = info
	updates.checking = false
	updates.mu.Unlock()
	a.EmitEvent("rick:update-available", info)
}

func (a *App) fetchLatestRelease() UpdateInfo {
	info := UpdateInfo{CurrentVersion: Version, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	ctx, cancel := context.WithTimeout(context.Background(), updateDownloadTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", GitHubRepo), nil)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", GitHubRepo)

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		info.Error = fmt.Sprintf("check for updates: %v", err)
		return info
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 256))
		info.Error = fmt.Sprintf("check for updates: GitHub returned %s: %s", response.Status, strings.TrimSpace(string(body)))
		return info
	}

	var release githubRelease
	if err := json.NewDecoder(response.Body).Decode(&release); err != nil {
		info.Error = fmt.Sprintf("decode release info: %v", err)
		return info
	}

	latest := strings.TrimPrefix(strings.TrimSpace(release.TagName), "v")
	info.LatestVersion = latest
	info.ReleaseNotes = strings.TrimSpace(release.Body)
	info.UpdateAvailable = compareVersions(latest, Version) > 0
	if info.UpdateAvailable {
		assetName := portableAssetName(latest, runtime.GOOS, runtime.GOARCH)
		for _, asset := range release.Assets {
			if asset.Name == assetName {
				info.AssetName = asset.Name
				info.DownloadURL = asset.BrowserDownloadURL
				break
			}
		}
		if info.DownloadURL == "" {
			info.Error = fmt.Sprintf("release %s has no %s asset", release.TagName, assetName)
			info.UpdateAvailable = false
		}
	}
	return info
}

// GetUpdateStatus returns the last update check result for the frontend.
func (a *App) GetUpdateStatus() UpdateInfo {
	updates.mu.Lock()
	defer updates.mu.Unlock()
	return updates.last
}

// InstallUpdate downloads the newest portable binary and swaps it in for the
// running executable, then relaunches. It returns once the swap has been
// scheduled; the app exits immediately afterwards so the updater can proceed.
func (a *App) InstallUpdate() error {
	updates.mu.Lock()
	if updates.installing {
		updates.mu.Unlock()
		return fmt.Errorf("an update is already installing")
	}
	updates.installing = true
	updates.mu.Unlock()
	defer func() {
		updates.mu.Lock()
		updates.installing = false
		updates.mu.Unlock()
	}()

	info := a.fetchLatestRelease()
	if info.Error != "" {
		return fmt.Errorf("%s", info.Error)
	}
	if !info.UpdateAvailable || info.DownloadURL == "" {
		return fmt.Errorf("no update available (current %s, latest %s)", Version, info.LatestVersion)
	}

	target, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate current executable: %w", err)
	}
	target, err = filepath.EvalSymlinks(target)
	if err != nil {
		return fmt.Errorf("resolve current executable: %w", err)
	}

	tempDir, err := os.MkdirTemp("", "rickdesktop-update-*")
	if err != nil {
		return fmt.Errorf("create update directory: %w", err)
	}
	newBinary := filepath.Join(tempDir, info.AssetName)
	if err := downloadFile(info.DownloadURL, newBinary); err != nil {
		_ = os.RemoveAll(tempDir)
		return err
	}

	script, err := stageUpdateScript(tempDir)
	if err != nil {
		_ = os.RemoveAll(tempDir)
		return err
	}

	if err := runDetached(script, newBinary, target); err != nil {
		_ = os.RemoveAll(tempDir)
		return fmt.Errorf("launch updater: %w", err)
	}
	// The updater waits for this process to exit, swaps the binary and
	// relaunches, so the app must quit now.
	if a.ctx != nil {
		go func() {
			time.Sleep(300 * time.Millisecond)
			wailsruntime.Quit(a.ctx)
		}()
	}
	return nil
}

// stageUpdateScript writes the platform updater script next to the downloaded
// binary and returns its path.
func stageUpdateScript(tempDir string) (string, error) {
	name := "install-update.sh"
	if runtime.GOOS == "windows" {
		name = "install-update.ps1"
	}
	payload, err := updateScripts.ReadFile("scripts/" + name)
	if err != nil {
		return "", fmt.Errorf("read bundled updater script: %w", err)
	}
	path := filepath.Join(tempDir, name)
	if err := os.WriteFile(path, payload, 0o700); err != nil {
		return "", fmt.Errorf("write updater script: %w", err)
	}
	return path, nil
}

// runDetached launches the updater so it survives this process exiting.
func runDetached(script, newBinary, target string) error {
	if runtime.GOOS == "windows" {
		command := exec.Command("powershell.exe",
			"-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
			"-File", script, "-NewBinary", newBinary, "-Target", target, "-ParentPid", strconv.Itoa(os.Getpid()))
		command.SysProcAttr = hiddenSysProcAttr()
		return command.Start()
	}
	command := exec.Command("/bin/sh", script, newBinary, target, strconv.Itoa(os.Getpid()))
	command.SysProcAttr = detachedSysProcAttr()
	return command.Start()
}

// downloadFile streams url into path (mode 0700) and returns any error.
func downloadFile(url, path string) error {
	ctx, cancel := context.WithTimeout(context.Background(), updateDownloadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("prepare download: %w", err)
	}
	request.Header.Set("User-Agent", GitHubRepo)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: server returned %s", url, response.Status)
	}
	output, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		return fmt.Errorf("create download file: %w", err)
	}
	if _, err := io.Copy(output, response.Body); err != nil {
		_ = output.Close()
		return fmt.Errorf("write download: %w", err)
	}
	if err := output.Close(); err != nil {
		return fmt.Errorf("close download file: %w", err)
	}
	return nil
}

// compareVersions returns >0 if a is newer than b, <0 if older, 0 if equal.
// Accepts optional "v" prefixes and treats a prerelease suffix (-beta.1) as
// older than the same version without one.
func compareVersions(a, b string) int {
	splitVersion := func(value string) ([]int, string) {
		value = strings.TrimPrefix(value, "v")
		if dash := strings.IndexByte(value, '-'); dash >= 0 {
			return parseNumericSegments(value[:dash]), value[dash+1:]
		}
		return parseNumericSegments(value), ""
	}
	leftSegments, leftPre := splitVersion(a)
	rightSegments, rightPre := splitVersion(b)

	length := len(leftSegments)
	if len(rightSegments) > length {
		length = len(rightSegments)
	}
	for index := 0; index < length; index++ {
		l, r := 0, 0
		if index < len(leftSegments) {
			l = leftSegments[index]
		}
		if index < len(rightSegments) {
			r = rightSegments[index]
		}
		if l != r {
			return l - r
		}
	}
	switch {
	case leftPre == "" && rightPre != "":
		return 1
	case leftPre != "" && rightPre == "":
		return -1
	case leftPre != "" && rightPre != "" && leftPre != rightPre:
		if leftPre < rightPre {
			return -1
		}
		return 1
	}
	return 0
}

// parseNumericSegments splits "1.2.3" into [1, 2, 3], ignoring any trailing
// non-numeric junk that slipped past the prerelease split.
func parseNumericSegments(value string) []int {
	var parts []int
	for _, segment := range strings.Split(value, ".") {
		end := len(segment)
		for index, character := range segment {
			if character < '0' || character > '9' {
				end = index
				break
			}
		}
		number, _ := strconv.Atoi(segment[:end])
		parts = append(parts, number)
	}
	return parts
}
