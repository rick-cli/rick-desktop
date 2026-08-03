#!/usr/bin/env bash
# Install Rick Desktop (portable binary + rickserve daemon) for the current
# platform. Existing rick CLI installations are left untouched; rickserve is
# installed next to the desktop binary so the app can always find it.
#
# Usage: ./install.sh [version]   (default: latest release)
set -euo pipefail

REPO="${RICKDESKTOP_REPO:-rick-cli/rick-desktop}"
INSTALL_DIR="${RICKDESKTOP_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${1:-latest}"
DOWNLOAD_BASE="https://github.com/${REPO}/releases/latest/download"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) PLATFORM="linux-amd64" ;;
  Linux:aarch64|Linux:arm64) PLATFORM="linux-arm64" ;;
  Darwin:x86_64|Darwin:amd64) PLATFORM="darwin-amd64" ;;
  Darwin:arm64) PLATFORM="darwin-arm64" ;;
  *) printf 'Unsupported platform: %s/%s\n' "$(uname -s)" "$(uname -m)" >&2; exit 1 ;;
esac

command -v curl >/dev/null 2>&1 || { printf 'curl is required.\n' >&2; exit 1; }

mkdir -p "$INSTALL_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

download() {
  local asset="$1" out="$2"
  printf 'Downloading %s…\n' "$asset"
  curl --fail --location --silent --show-error "$DOWNLOAD_BASE/$asset" -o "$out"
}

if [ "$VERSION" = "latest" ]; then
  version_tag="$(curl --fail --silent --show-error "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')"
else
  version_tag="v${VERSION#v}"
fi
version="${version_tag#v}"

download "RickDesktop-v${version}-${PLATFORM}" "$TMP_DIR/rickdesktop"
download "rickserve-v${version}-${PLATFORM}" "$TMP_DIR/rickserve"

install -m 0755 "$TMP_DIR/rickdesktop" "$INSTALL_DIR/rickdesktop"
install -m 0755 "$TMP_DIR/rickserve" "$INSTALL_DIR/rickserve"

printf 'Installed Rick Desktop to %s/rickdesktop\n' "$INSTALL_DIR"
printf 'Installed rickserve daemon to %s/rickserve\n' "$INSTALL_DIR"
printf 'Run: rickdesktop\n'
