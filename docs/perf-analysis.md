# CPU & RAM analysis — Rick Desktop

Measured: 2026-08-03 on Windows 11 (git-bash), machine running the app plus a
terminal session.

## Where the resources go today

### RAM

| Process | Count | Working set (typical) | Notes |
|---|---|---|---|
| `msedgewebview2.exe` | ~19 | ~15–115 MB each, ~1.1 GB total | WebView2 spawns one browser process per GPU/renderer/utility role. The **renderer holding the React app is usually the 100+ MB one**; the rest are WebView2 plumbing (network, GPU, audio, crashpad, com-server). |
| `rick.exe` (rickserve daemon) | 1 | ~75 MB | Started once by the app; the real chat agent runs inside it. |
| `rickdesktop.exe` | 1 | ~15 MB | Thin Go/Wails shell. |

Conclusion: ~1.2 GB of the app footprint is the WebView2 browser engine, not
app code. This is fixed cost for any webview shell (Tauri/Electron/CEF are the
same or worse). What we *can* save is everything the app does *on top*:

### CPU / wasted work

Every one of these used to spawn a fresh `rickserve` process (~90–95 ms, one
Go runtime boot each) or re-parse the full session directory:

1. `GetRickVersion()` — called by `GetRuntimeInfo()` on **every settings open
   and diagnostics mount**. Each call ran `rick version` (~95 ms spawn).
2. `GetProviders()` — called on **every chat-page mount** (the composer model
   picker). Each call spawned a fresh `rickserve models` (~95 ms).
3. `GetResolvedConfig` / `GetAuthStatus` / `GetMCPStatus` / `GetUsageStats` /
   `RequestGoals` / `RequestSnapshot` — each went through `queryOneShot`
   (fresh `rickserve` spawn, ~85–95 ms).
4. `GetSessions()` — re-parsed every session `.json` file (full message
   history) to build the sidebar list. 66 sessions ≈ **84 ms** per refresh,
   and the sidebar refreshes after every completed run.
5. Frontend: `collectContextFiles()` and `visibleMessages()` re-ran on every
   render; every assistant `text.delta` re-rendered **all** rows; `usage`
   events fired `GetUsageStats` synchronously per event (a burst of ~95 ms
   spawns while a run streams).
6. `rick:usage` events fired `getUsageStats()` immediately — several fresh
   rickserve spawns per run.

## What changed (all shipped in this pass)

| Area | Before | After |
|---|---|---|
| Session list | 84 ms (parse all JSON) | ~16 ms via rick's `.meta.json` files (5×) |
| `GetRickVersion` | 95 ms spawn each call | cached 30 s |
| `GetProviders` | 95 ms spawn each mount | cached 30 s |
| one-shot queries (config/auth/MCP/plugins/goals/snapshots) | 95 ms spawn each | cached 5 s, invalidated on writes |
| `usage` event → usage stats | immediate spawn per event | debounced 1.5 s (one refresh per burst) |
| Render work | re-derive context files + visible messages + all rows on every delta | `useMemo` + `memo(MessageRow)`; only the streaming row re-renders |
| Chat switch | full disk read before paint | cached history paints instantly, disk refresh in background |
| Settings open | "Loading Settings" until 4 queries finished | shows current config immediately, reloads in background |
| **WebView2 RAM** | 383 MB (browser 121 + renderer 104 + GPU 87 + utilities) | **339 MB** — `--disable-gpu` (GPU drops to 52 MB SwiftShader software) + SmartScreen off |

Net effect on the hot path: instead of ~6 fresh `rickserve` boots on startup +
every settings open + every run completion, the app now does **one** at
startup (providers) and serves the rest from memory. That removes roughly
500–600 ms of process-spawn latency and the associated CPU spikes on every
tab switch, and the steady-state CPU from repeated re-parses/re-renders.

## Measured RAM before/after (same machine, 12 s after launch)

| Component | Before | After | Delta |
|---|---|---|---|
| msedgewebview2 (6 procs) | 382.6 MB | 339.1 MB | **−43.5 MB (−11%)** |
| └ browser process | 121.4 MB | 120.4 MB | −1 MB |
| └ renderer (React app) | 103.6 MB | 88.5 MB | −15 MB |
| └ GPU process | 86.7 MB | 51.8 MB | −35 MB (software fallback) |
| └ network utility | 36.1 MB | 36.2 MB | — |
| rickdesktop.exe shell | 34.7 MB | 35.0 MB | — |
| rickserve | ~13 MB | ~13 MB | — |
| **App total** | **~430 MB** | **~387 MB** | **−43 MB** |

Flags verified on the WebView2 browser command line: `--disable-gpu` and
`--disable-features=msSmartScreenProtection`. Disabling the GPU is safe here:
the app renders only local flat UI (no video, WebGL or 3D CSS), so Chromium's
SwiftShader software fallback produces identical pixels; the caret blink,
fades and pulse animations run fine on the CPU. SmartScreen phishing checks
are pointless for a local-asset app and no longer run in the background.

These are the only two RAM levers Wails v2.12 exposes through its public API
(`pkg/options/windows.Options` has no arbitrary browser-argument field, and
the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var is ignored once Wails
passes its own non-empty args). Further gains would require forking the
module to add `--renderer-process-limit`/`--js-flags`.

## Not changed, on purpose

- WebView2 multi-process RAM beyond the above (~339 MB). The remaining big
  processes are the browser (120 MB) and renderer (88 MB) — the actual cost of
  running a Chromium engine; the only way to shrink those is `--js-flags` /
  `--renderer-process-limit`, which Wails v2.12 does not expose without
  forking the module.
- Provider/model fetch freshness — 30 s cache is short enough to not go stale
  while auth flows run.

## How to verify

1. `go test ./...`, `npm run test` (in `frontend`), `python scripts/verify.py`.
2. Launch `build/bin/RickDesktop.exe`; Task Manager should show a single
   short-lived `rickserve` spawn at startup, then none on tab switches.
3. Open Settings → it paints instantly, no "Loading Settings" flash.
4. Switch chats in the sidebar → instant paint, then silent disk refresh.
5. Type in the composer → Enter submits (Shift+Enter = newline); `Tab`
   accepts the slash-command suggestion; avatars show a dot, not `Y`/`❯`.
6. Run a chat in the `rick` CLI, then focus the desktop window → the new
   session and its messages appear in the shared history.
