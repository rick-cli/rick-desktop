package main

import "time"

// Version is the current Rick Desktop release. It must match the git tag
// (vX.Y.Z) and wails.json productVersion for update checks to work. The
// release workflow overrides it with the tag via -ldflags "-X main.Version=…".
var Version = "0.1.3"

// GitHubRepo is where Rick Desktop releases (installers, portable binaries,
// rickserve assets) are published.
const GitHubRepo = "rick-cli/rick-desktop"

// RickCLIRepo is where the rick CLI binary and its official install scripts
// are published.
const RickCLIRepo = "rick-cli/rick"

// updateDownloadTimeout bounds a single release query/download so a stalled
// network never blocks the UI forever.
const updateDownloadTimeout = 5 * time.Minute
