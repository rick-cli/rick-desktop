package main

import "testing"

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.0", "0.1.0", 0},
		{"v0.1.0", "0.1.0", 0},
		{"0.1.1", "0.1.0", 1},
		{"0.1.0", "0.1.1", -1},
		{"0.2.0", "0.10.0", -1},
		{"1.0.0", "0.9.9", 1},
		{"0.1.0-beta.1", "0.1.0", -1},
		{"0.1.0", "0.1.0-beta.1", 1},
		{"0.1.0", "0.1", 0},
		{"0.1.1-beta.2", "0.1.1-beta.1", 1},
	}
	for _, tc := range cases {
		got := compareVersions(tc.a, tc.b)
		if (got > 0) != (tc.want > 0) || (got < 0) != (tc.want < 0) || (got == 0) != (tc.want == 0) {
			t.Errorf("compareVersions(%q, %q) = %d, want sign %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestPortableAssetName(t *testing.T) {
	cases := []struct {
		version, goos, goarch, want string
	}{
		{"0.1.0", "windows", "amd64", "RickDesktop-v0.1.0-windows-amd64.exe"},
		{"v0.1.0", "darwin", "arm64", "RickDesktop-v0.1.0-darwin-arm64"},
		{"0.1.0", "linux", "amd64", "RickDesktop-v0.1.0-linux-amd64"},
	}
	for _, tc := range cases {
		if got := portableAssetName(tc.version, tc.goos, tc.goarch); got != tc.want {
			t.Errorf("portableAssetName(%q, %q, %q) = %q, want %q", tc.version, tc.goos, tc.goarch, got, tc.want)
		}
	}
}
