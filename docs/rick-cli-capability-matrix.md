# Rick CLI and rickserve capability matrix

Inventory date: 2026-08-03
Installed CLI: `rick v0.1.6`
Inventory mode: black-box (Rick source tree was not found in the inspected workspace locations).

No credential values are included in this document or its fixtures.

## Executable resolution

| Tool | Resolved path |
|---|---|
| `rick` | `C:\Users\einme\bin\rick` |
| `rick.exe` | `C:\Users\einme\bin\rick.exe` |
| `rickserve` | `C:\Users\einme\bin\rickserve` |
| `rickserve.exe` | `C:\Users\einme\bin\rickserve.exe` |

## Version and top-level commands

`rick version` prints `rick v0.1.6`.

`rick --version` is not a supported alias; it prints `rick: unknown flag: --version`.

Top-level commands reported by `rick help`:

- `apply` — apply the latest agent diff with `git apply`
- `completion` — generate shell completion
- `config` — show resolved configuration
- `doctor` — local health diagnostics; `--network` enables provider probes
- `exec` — non-interactive/headless execution
- `help`
- `models` — list available models
- `resume` — browse and resume saved sessions interactively
- `run` — run a single prompt in the TUI
- `security` — dependency vulnerability audit
- `serve` — redirects users to `rickserve`
- `session` — export one session to JSON
- `sessions` — list/manage sessions
- `uninstall`
- `update`
- `version`

Global flags observed:

- `-a, --agent string` (`build | plan`)
- `-c, --continue`
- `-h, --help`
- `-m, --model string` (`provider/model-id`)
- `--new` (fresh session; now default)
- `--no-network`
- `--permission-profile string` (`readonly | standard | trusted | ci` or custom)
- `-p, --prompt string`
- `--resume string`
- `--sandbox string` (`read-only | workspace-write | trusted | off`)
- `--sandbox-enforcement string` (`auto`, `os`, `static`)
- `--yolo`

## Command matrix

| Command | Verified arguments/options | Desktop mapping |
|---|---|---|
| `version` | No flags; prints version | About/diagnostics |
| `run` | `[prompt]`; `-m, --model string` | Chat run through rickserve |
| `exec` | `[prompt]`; `--max-turns` default `50`; `-m, --model`; `-o, --output-format` = `text | json | stream-json`, default `text`; `-p, --prompt`; `--permission-profile`; `--sandbox`; `--yolo` | Structured action/output panel |
| `models` | No flags | Model picker and refresh |
| `config` | No flags | Settings and raw config preview |
| `sessions` | `--all`; subcommands `fork`, `import`, `rename`, `search` | Session sidebar/actions |
| `sessions fork` | `<id>` | Fork action |
| `sessions import` | `<file>`; `--source` = `auto | opencode | kilo | codex`, default `auto` | Import action |
| `sessions rename` | `<id> <title>` | Rename action |
| `sessions search` | `<query>` | Sidebar search |
| `session export` | `<id>`; `-o, --output`; `--pretty` | Export action |
| `resume` | No flags; interactive browser | Open/resume session |
| `apply` | `--dry-run`; `--last` default true; `--session string` | Reviewable diff/apply action |
| `doctor` | `--network` | Diagnostics panel |
| `security` | `--dir` default `.`; `--force`; `--format` = `table | json`, default `table` | Security panel |
| `completion` | `bash`, `fish`, `powershell`, `zsh`; shell-specific `--no-descriptions` | Copyable shell completion |
| `update` | No flags in help | Advanced update action |
| `uninstall` | No flags in help | Advanced, explicit-confirmation-only action |
| `serve` | Not a usable command; directs to `rickserve` | Do not invoke; use rickserve directly |

## rickserve protocol observations

`rickserve` accepts newline-delimited JSON on stdin and emits newline-delimited JSON on stdout. The documented examples show `run`, `models`, and `sessions` request types, but the installed binary was tested as the authority.

Observed safe requests:

| Request | Observed response |
|---|---|
| `{"type":"ping"}` | `{"type":"pong"}` |
| `{"type":"models"}` | `{"type":"models","data":{"models":[...]}}`; model entries include `provider`, `id`, `name`, optional `context_window`, optional `source`, optional `configured`, and optional `default`; generic entries omit some optional metadata, configured entries use `source: "configured"` and `configured: true` |
| `{"type":"sessions"}` | Either `{"type":"sessions","data":[...]}` with session summaries or `{"type":"sessions","data":null}` when no list is available; Desktop normalizes both to an empty-or-populated list |
| `{"type":"help"}` | `{"type":"error","error":"unknown request type \\\"help\\\""}` |
| `{"type":"capabilities"}` | `{"type":"error","error":"unknown request type \\\"capabilities\\\""}` |
| `{"type":"version"}` | `{"type":"error","error":"unknown request type \\\"version\\\""}` |
| `{"type":"wat"}` | `{"type":"error","error":"unknown request type \\\"wat\\\""}` |
| malformed JSON | `{"type":"error","error":"malformed request: ..."}` |

No provider run was started during inventory because it could make network calls and mutate the live session store. Therefore exact live run/tool/reasoning/swarm event names remain a compatibility surface: the bridge preserves unknown events and supports the legacy `event` envelope already used by the existing Desktop code. These event categories require a disposable/fake run fixture before being considered authoritative.

The compatibility fixture `internal/bridge/fixtures/legacy-stream.jsonl` represents the event envelope already handled by the current Desktop (`Content` and `done`) and is not claimed as a newly captured provider trace.

## Data paths observed/retained

The existing Desktop uses Rick's Windows paths:

- Roaming config: `%APPDATA%\\rick\\rick.json`
- Roaming credentials: `%APPDATA%\\rick\\auth.json` (read only for non-secret provider metadata)
- Local data/sessions: `%LOCALAPPDATA%\\rick\\sessions`

Secret values are never returned by the new config APIs, logged, or included in exports.

## Remaining black-box inventory

The installed binary did not expose a help/capabilities request through rickserve, and no safe provider run was started. Exact event payloads for provider reasoning, tool approvals/results, cancellation, and swarms must be added when a disposable provider/fake runtime is available. Unknown events will remain visible in diagnostics rather than being discarded.
