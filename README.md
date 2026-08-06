<img width="1917" height="1004" alt="grafik" src="https://github.com/user-attachments/assets/77575391-2b09-4a26-804e-ca9469ff6cd3" /># Rick Desktop

A visual desktop workspace for the [rick](https://github.com/rick-cli/rick) AI coding agent. Rick Desktop drives the `rick` CLI through a local chat, live tool timeline, session manager, and settings — no terminal required.
<img width="1255" height="752" alt="grafik" src="https://github.com/user-attachments/assets/fc5ced48-eae9-4ac1-9092-15ce4171dbb5" />


## Features

- **Chat with rick** — send prompts, attach files, approve or deny tool calls inline.
- **Live agent view** — watch the reasoning, tools, diffs and swarm activity as rick works.
- **Sessions** — browse, search, rename, favorite, fork and export the same session history the CLI uses.
- **Usage insights** — token counts per session, day and model.
- **Themes & display** — a flat, keyboard-friendly UI with several palettes and font sizes.
- **Setup built in** — if the rick CLI is missing, Rick Desktop installs it (and its `rickserve` daemon) for you on first run.
- **Self-updating** — checks for new releases on start and every 10 minutes; an **Update** button appears at the bottom right when one is available.

## Requirements

- **Windows 10/11**, **macOS**, or **Linux** (WebView2 on Windows is installed automatically).
- The [rick CLI](https://github.com/rick-cli/rick) — Rick Desktop installs it automatically on first run if it isn't found.

## Install

Every release ships three ways: an installer for each OS, a portable single file that needs no installation, and curl/PS1 install scripts.

| Platform | Installer | Portable (no install) |
| --- | --- | --- |
| Windows | `RickDesktop-Setup-vX.Y.Z-windows-amd64.exe` (NSIS) | `RickDesktop-vX.Y.Z-windows-amd64.exe` |
| macOS | `RickDesktop-vX.Y.Z-darwin-<arch>.app.zip` (drag to Applications) | `RickDesktop-vX.Y.Z-darwin-<arch>` |
| Linux | `RickDesktop-vX.Y.Z-linux-<arch>.deb` | `RickDesktop-vX.Y.Z-linux-<arch>` |

Download from the [releases page](https://github.com/rick-cli/rick-desktop/releases).

### Scripted install

```bash
# Linux / macOS
curl -fsSL https://github.com/rick-cli/rick-desktop/releases/latest/download/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://github.com/rick-cli/rick-desktop/releases/latest/download/Install-RickDesktop.ps1 | iex
```

The scripts install the portable binary plus the `rickserve` daemon into `~/.local/bin` (or `%LOCALAPPDATA%\RickDesktop\bin` on Windows).

## First run

1. Launch Rick Desktop. If the `rick` CLI is already on your machine, you're done — the app connects to it.
2. If it isn't, the setup screen appears with an **Install Rick** button. It downloads the official rick binary and `rickserve`, then starts the workspace.
3. Configure your provider credentials in **Settings → Providers** (the same auth files the CLI uses).

## Updating

Rick Desktop checks GitHub on launch and then every 10 minutes. When a newer release exists, an **Update to vX.Y.Z** button appears at the bottom right. Clicking it downloads the new portable binary, swaps it in for the running executable, and relaunches — your settings and sessions are untouched.

Manual update, from the project root:

```bash
curl -fsSL https://github.com/rick-cli/rick-desktop/releases/latest/download/install.sh | sh   # re-runs the installer
```

## Building from source

Prerequisites: Go 1.25+, Node 20+, [Wails v2](https://wails.io/docs/gettingstarted/installation), and the platform build dependencies (NSIS for the Windows installer, `libwebkit2gtk-4.1-dev` etc. on Linux).

```bash
./scripts/build.sh            # current platform, artifacts in build/dist
wails build -nsis             # Windows installer + portable exe
```

The official cross-platform build (Windows installer, macOS app, Linux .deb, portable binaries for all platforms, and the `rickserve` assets the app installs) runs automatically on GitHub Actions when a `v*` tag is pushed — see `.github/workflows/release.yml`.

## Development

```bash
wails dev                     # live-reload UI + backend
cd frontend && npm run test   # Vitest suite
go test ./...                 # Go tests
```

- `src/` code lives in `app.go` (backend), `frontend/src/` (UI), and `internal/` (bridge, config, sessions, usage).
- Release version lives in `version.go`, `wails.json`, and the git tag — keep all three in sync.

## License

MIT — see [LICENSE](LICENSE).
