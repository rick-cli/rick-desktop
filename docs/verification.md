# Verification

Run from the repository root:

```text
python scripts/verify.py
```

This is the canonical full verification for the Desktop working tree:

1. `go test ./...`
2. `npm test -- --run` in `frontend/`
3. `npm run build` in `frontend/`
4. `wails build -clean -o RickDesktop.exe`
5. Check `build/bin/RickDesktop.exe` exists and is larger than 1 MB; print its SHA-256.

For a faster source-only check, use `python scripts/verify.py --skip-wails`.

A bounded launch smoke test is intentionally separate because it needs a GUI session:

```text
timeout 12s ./build/bin/RickDesktop.exe
```

Expected machine evidence is WebView2 environment creation followed by the timeout exit; inspect the process list afterward and only terminate the process started by this check. Visual claims about layout, font rendering, and interaction still require human eyes in a Windows desktop session.
