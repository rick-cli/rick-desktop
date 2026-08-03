package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// RickStatus reports whether the rick CLI and its rickserve daemon are
// available, plus where they resolve from. The desktop cannot run without
// both: rickserve speaks the protocol the app drives.
type RickStatus struct {
	Installed     bool   `json:"installed"`
	RickPath      string `json:"rick_path"`
	RickservePath string `json:"rickserve_path"`
	RickVersion   string `json:"rick_version"`
	InstallDir    string `json:"install_dir"`
}

// rickBinName returns the rick executable filename for this platform.
func rickBinName() string {
	if runtime.GOOS == "windows" {
		return "rick.exe"
	}
	return "rick"
}

func rickserveBinName() string {
	if runtime.GOOS == "windows" {
		return "rickserve.exe"
	}
	return "rickserve"
}

// rickInstallDir is where the desktop installs rick + rickserve when they are
// missing. It mirrors the official rick installers (%LOCALAPPDATA%\Rick\bin
// on Windows, ~/.local/bin elsewhere).
func rickInstallDir() string {
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, "Rick", "bin")
		}
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "bin")
}

// rickCandidatePaths lists every place a rick/rickserve pair can live, in
// priority order: the configured override, the desktop install dir, the user
// bin dir, then PATH.
func (a *App) rickCandidatePaths() []string {
	home, _ := os.UserHomeDir()
	var candidates []string
	if value, err := a.configStore.Load(); err == nil && value.RickservePath != "" {
		candidates = append(candidates, value.RickservePath)
	}
	candidates = append(candidates,
		filepath.Join(rickInstallDir(), rickserveBinName()),
		filepath.Join(home, "bin", rickserveBinName()),
		rickserveBinName(),
	)
	return candidates
}

func (a *App) findRick() string {
	if path, err := exec.LookPath(rickBinName()); err == nil {
		return path
	}
	return ""
}

// resolveRickservePath resolves the rickserve executable, honouring the
// configured override first, then standard install dirs and PATH.
func (a *App) resolveRickservePath() (string, error) {
	for _, candidate := range a.rickCandidatePaths() {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", errors.New("rickserve not found; run Setup in Rick Desktop or install Rick (rick-cli/rick)")
}

// rickReady reports whether both required executables are available.
func (a *App) rickReady() bool {
	if a.findRick() == "" {
		return false
	}
	_, err := a.resolveRickservePath()
	return err == nil
}

// GetRickStatus returns the current rick CLI / rickserve availability.
func (a *App) GetRickStatus() RickStatus {
	status := RickStatus{InstallDir: rickInstallDir()}
	status.RickPath = a.findRick()
	if path, err := a.resolveRickservePath(); err == nil {
		status.RickservePath = path
	}
	if status.RickPath != "" && status.RickservePath != "" {
		status.Installed = true
		status.RickVersion = a.GetRickVersion()
	}
	return status
}

// emitRickStatus pushes the current rick availability to the frontend so it
// can show the setup flow when the CLI is missing.
func (a *App) emitRickStatus() {
	a.EmitEvent("rick:status", a.GetRickStatus())
}

// InstallRick downloads the rick CLI (from rick-cli/rick) and rickserve (from
// the Rick Desktop release, which ships the daemon binary) into the standard
// install dir, then restarts the runtime. Missing pieces are installed
// individually, so an existing rick is left untouched.
func (a *App) InstallRick() (RickStatus, error) {
	ctx, cancel := context.WithTimeout(context.Background(), updateDownloadTimeout)
	defer cancel()

	status := RickStatus{InstallDir: rickInstallDir()}
	status.RickPath = a.findRick()
	status.RickservePath, _ = a.resolveRickservePath()

	if status.RickPath == "" {
		if err := installRickCLI(ctx, status.InstallDir); err != nil {
			return status, err
		}
		status.RickPath = filepath.Join(status.InstallDir, rickBinName())
	}
	if status.RickservePath == "" {
		if err := installRickserve(ctx, status.InstallDir); err != nil {
			return status, err
		}
		status.RickservePath = filepath.Join(status.InstallDir, rickserveBinName())
		a.persistRickservePath(status.RickservePath)
	}
	status.Installed = true
	status.RickVersion = a.GetRickVersion()

	// Restart the daemon so the app can drive rick immediately.
	a.startRickserve()
	a.emitRickStatus()
	return status, nil
}

// persistRickservePath records where rickserve was installed so later lookups
// hit the desktop-installed copy even if PATH changes.
func (a *App) persistRickservePath(path string) {
	config, err := a.configStore.Load()
	if err != nil {
		return
	}
	config.RickservePath = path
	_ = a.configStore.Save(config)
}

// installRickCLI downloads the rick binary from the CLI's own latest GitHub
// release and installs it into dir.
func installRickCLI(ctx context.Context, dir string) error {
	release, err := fetchRelease(ctx, RickCLIRepo)
	if err != nil {
		return fmt.Errorf("resolve rick release: %w", err)
	}
	assetName := "rick-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		assetName += ".exe"
	}
	url, ok := release.assetURL(assetName)
	if !ok {
		return fmt.Errorf("rick release %s has no %s asset", release.TagName, assetName)
	}
	target := filepath.Join(dir, rickBinName())
	if err := downloadTo(ctx, url, target); err != nil {
		return fmt.Errorf("install rick: %w", err)
	}
	return nil
}

// installRickserve downloads the rickserve daemon from the Rick Desktop
// release (the desktop release workflow publishes it alongside the app).
func installRickserve(ctx context.Context, dir string) error {
	release, err := fetchRelease(ctx, GitHubRepo)
	if err != nil {
		return fmt.Errorf("resolve rickserve release: %w", err)
	}
	version := strings.TrimPrefix(release.TagName, "v")
	assetName := "rickserve-v" + version + "-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		assetName += ".exe"
	}
	url, ok := release.assetURL(assetName)
	if !ok {
		return fmt.Errorf("Rick Desktop release %s has no %s asset", release.TagName, assetName)
	}
	target := filepath.Join(dir, rickserveBinName())
	if err := downloadTo(ctx, url, target); err != nil {
		return fmt.Errorf("install rickserve: %w", err)
	}
	return nil
}

type releaseInfo struct {
	TagName string
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	}
}

func (r releaseInfo) assetURL(name string) (string, bool) {
	for _, asset := range r.Assets {
		if asset.Name == name {
			return asset.BrowserDownloadURL, true
		}
	}
	return "", false
}

func fetchRelease(ctx context.Context, repo string) (releaseInfo, error) {
	var info releaseInfo
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo), nil)
	if err != nil {
		return info, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", GitHubRepo)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return info, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return info, fmt.Errorf("GitHub returned %s", response.Status)
	}
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		return info, err
	}
	return info, nil
}

// downloadTo streams a release asset into dir/name (mode 0700) and chmods it
// executable on Unix.
func downloadTo(ctx context.Context, url, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", GitHubRepo)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %s", response.Status)
	}
	temporary := target + ".tmp"
	output, err := os.OpenFile(temporary, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, response.Body); err != nil {
		_ = output.Close()
		_ = os.Remove(temporary)
		return err
	}
	if err := output.Close(); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(temporary, 0o755); err != nil {
			_ = os.Remove(temporary)
			return err
		}
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
