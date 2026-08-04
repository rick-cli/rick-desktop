# Rick CLI → Rick Desktop: gap inventory

Inventory date: 2026-08-03
Source of truth: `G:\projectE` (rick CLI source) vs `G:\RickDesktop` (frontend + `app.go`).
Both builds green; rickserve protocol v2 with attachments landed on the Desktop side today.

## Legend
- ✅ already in Desktop
- 🔶 partial (present but reduced/read-only/not surfaced)
- ❌ missing

## 1. Agent loop & tools (runs through rickserve, so mostly inherited)

| Capability | Status | Notes |
|---|---|---|
| chat run / stop / resume | ✅ | `run` + `cancel` protocol |
| 31 tools: 18 core (read/write/edit/bash/grep/glob/list/apply_patch/todoread/todowrite/code_symbols/git/diagnostics/test/tree/fetch/memory/websearch) + 4 goal + 9 subagent/swarm | ✅ | surfaced as `ToolUse`/`ToolResult` timeline events; full list in the Tools panel |
| tool approvals (`PermissionRequest`) | ✅ | routed via protocol v2 |
| sandbox (read-only / workspace-write / trusted / off) | ✅ | config + per-run option |
| YOLO mode | ✅ | toolbar toggle |
| thinking levels (auto/off/low/medium/high) | ✅ | toolbar + header dropdown |
| parallel tool calls / subagents / teams / swarms | ✅ | swarm timeline events + inspector |
| **undo / redo (git snapshot backed)** | ❌ | `/undo` `/redo` exist only in TUI; desktop has no snapshot UI |
| **compact transcript** (`/compact`) | ❌ | |
| **goal tracking** (`/goal`) | ❌ | |

## 2. Input & attachments

| Capability | Status | Notes |
|---|---|---|
| attach image + text files via **+ button**, removable chip | ✅ | NEW today; images rejected with a visible error unless the model reports vision |
| `@file` fuzzy picker → paste file contents | ❌ | TUI-only (`picker.go expandFileRefs`) |
| paste image/file from clipboard | ❌ | TUI-only (`clipboard_win.go`) |
| `!cmd` shell escape | ❌ | run `bash` tool directly instead |
| `@agent` mention → task delegation | ❌ | TUI-only |
| input history (↑/↓) | ❌ | |
| slash-command menu | ✅ | `/` suggestions + execution of a subset |

## 3. Sessions

| Capability | Status | Notes |
|---|---|---|
| list / open / rename / fork / export / import | ✅ | sidebar + settings |
| search sessions | ✅ | settings + catalog |
| **import from Codex / Kilo / OpenCode formats** | ❌ | Desktop import only `auto`; rick supports `--source opencode|kilo|codex` |
| **git-backed snapshot restore (undo/redo across restarts)** | ❌ | |
| **resume with `--resume <id>` / continue flag** | ❌ | sidebar reopens session but no resume/continue semantics |

## 4. Providers & models

| Capability | Status | Notes |
|---|---|---|
| list configured providers/models | ✅ | `GetProviders` |
| model picker (per-conversation) | ✅ | composer + header |
| provider auth flow (`/auth` device-code / API key / OAuth) | ❌ | desktop relies on rick CLI's existing auth files |
| model filter (hide image/audio/speech models) | ✅ | inherited via `FilterChatModels` |
| **vision capability per model** | ✅ | NEW today (drives attachment gating) |
| refresh model list (`/refreshmodellist`) | ❌ | `/models` refresh only |

## 5. Diagnostics & maintenance

| Capability | Status | Notes |
|---|---|---|
| usage stats (tokens/day, per model) | ✅ | stats page + usage insights |
| `doctor` (health check + `--network`) | ✅ | catalog command → runs via CLI |
| `security` (dependency audit) | ✅ | catalog command |
| `update` rick | ✅ | catalog command |
| **uninstall (full/part)** | ❌ | maintenance choice UI is TUI-only |
| config viewer/editor | ✅ | settings page |
| **raw config preview** (resolved JSONC w/ substitutions) | 🔶 | settings show some values; no `rick config` output panel |

## 6. Theme & appearance

| Capability | Status | Notes |
|---|---|---|
| Codex-style theme | ✅ | redesigned |
| **custom themes (`.rick/themes/*.json`)** | ❌ | rick ships 4 built-ins + user JSON themes; desktop ignores them |
| light/system theme | ✅ | settings |
| font size | ✅ | settings |

## 7. MCP / plugins / agents

| Capability | Status | Notes |
|---|---|---|
| MCP client (stdio + http) | 🔶 | rick connects MCP servers at startup; desktop shows no MCP status/panel |
| plugin hooks & **skills** | ❌ | rick has `internal/plugin` (loader, script, skill); desktop has no UI |
| **agent picker** (view/attach agents, `/agents`) | ❌ | swarm inspector exists, but no agent attach/delegate UI |

## 8. rickserve protocol deltas (for feature parity the backend must grow)

- `run` now accepts `attachments[]` (name/media_type/data base64) — NEW
- no `compact` request type
- no `snapshot/undo/redo` request types
- no `mcp` / `plugins` query types
- no `goal` request type
- `sessions` import only `auto` source; `--source codex|kilo|opencode` not exposed

## Suggested next work (highest value first)

1. **@file picker + clipboard paste** — closest to TUI parity for attaching context; reuses today's attachment pipeline.
2. **undo/redo UI** — rick snapshots exist server-side; add `snapshot` request + diff viewer.
3. **MCP & plugins status panel** — rick already connects them; surface connected servers/hooks in settings.
4. **session import sources (codex/kilo/opencode)** — small backend pass-through.
5. **`rick config` raw output panel** — show resolved JSONC with substitutions, read-only.
6. **custom theme support** — load `.rick/themes/*.json` into the desktop palette.
