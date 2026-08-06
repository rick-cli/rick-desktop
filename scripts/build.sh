#!/usr/bin/env bash
# Local build helper. Produces the platform artifacts (installer where one
# exists) into build/dist. The canonical cross-platform build lives in
# .github/workflows/release.yml; this mirrors the current platform only.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-0.1.2}"
PLATFORM="$(go env GOOS)-$(go env GOARCH)"
OUT_NAME="RickDesktop-v${VERSION}-${PLATFORM}"
[ "$(go env GOOS)" = "windows" ] && OUT_NAME="${OUT_NAME}.exe"

export PATH="$PATH:/c/Program Files (x86)/NSIS"

echo "[build] wails build (version $VERSION)"
if [ "$(go env GOOS)" = "windows" ]; then
  wails build -clean -nsis -ldflags "-s -w -X main.Version=${VERSION}" -o "$OUT_NAME"
else
  wails build -clean -ldflags "-s -w -X main.Version=${VERSION}" -o "$OUT_NAME"
fi

mkdir -p build/dist
cp "build/bin/$OUT_NAME" "build/dist/$OUT_NAME"
if [ "$(go env GOOS)" = "windows" ] && [ -f "build/bin/RickDesktop-amd64-installer.exe" ]; then
  cp "build/bin/RickDesktop-amd64-installer.exe" "build/dist/RickDesktop-Setup-v${VERSION}-windows-amd64.exe"
fi
echo "[build] artifacts in build/dist:"
ls -la build/dist
