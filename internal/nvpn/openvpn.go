// OpenVPN mode: import a .ovpn profile and run it as a strict split tunnel.
// The generated config drops any redirect-gateway/pulled routes and pins
// routes for only the AI provider IP blocks, so nothing outside those ranges
// (and nothing outside rickserve, which is the only process pointed at the
// local proxy) is affected by the VPN.
package nvpn

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ImportResult describes a successfully imported .ovpn profile.
type ImportResult struct {
	ConfigName string `json:"config_name"`
	Server     string `json:"server"`
	Routes     int    `json:"routes"`
}

// OpenVPNService runs one imported .ovpn profile. The local loopback proxy is
// started with a direct dialer: once the OS routes the pinned provider IPs
// through the tunnel, those packets leave via the VPN and everything else via
// the normal connection.
type OpenVPNService struct {
	mu         sync.Mutex
	dir        string
	connected  bool
	server     string
	proxyURL   string
	listener   net.Listener
	proxy      *http.Server
	mgmtPort   int
}

// NewOpenVPN returns an idle OpenVPN mode service rooted at dir, where the
// sanitized config, auth, pid and log files are kept.
func NewOpenVPN(dir string) *OpenVPNService {
	return &OpenVPNService{dir: dir}
}

// Status returns the current connection snapshot. When the in-memory state
// is stale (the app restarted while the tunnel stayed up), it reconciles
// against the pid file so the UI shows the live tunnel.
func (s *OpenVPNService) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.connected {
		if pidData, err := os.ReadFile(filepath.Join(s.dir, "openvpn.pid")); err == nil {
			if pid, err := strconv.Atoi(strings.TrimSpace(string(pidData))); err == nil && pid > 0 && processAlive(pid) {
				s.connected = true
				if s.server == "" {
					s.server = remoteServer(readConfig(s.dir))
				}
			}
		}
	}
	return s.snapshotLocked()
}

func (s *OpenVPNService) snapshotLocked() Status {
	return Status{
		Connected: s.connected,
		Mode:      "openvpn",
		Server:    s.server,
		ProxyURL:  s.proxyURL,
	}
}

// droppedLine matches directives that must not survive into the generated
// config: anything that would pull or install a default route (making the
// tunnel system-wide), plus directives we regenerate ourselves.
var droppedLine = regexp.MustCompile(`(?i)^\s*(redirect-gateway|route\b|route-nopull|route-delay|pull\b|pull-filter|dhcp-option|dhcp-renew|register-dns|ip-win32|block-outside-dns|setenv|route-up|route-pre-down|\bup\b|\bdown\b|auth-user-pass|management|writepid|log\b|log-append|verb\b|mute\b|script-security|service|silent)\b`)

// externalFile lists directives whose argument is a path to a local file that
// must be copied next to the generated config (Proton configs are
// self-contained, but not all providers' are).
var externalFile = map[string]bool{"ca": true, "cert": true, "key": true, "tls-auth": true, "crl-verify": true, "pkcs12": true}

// ImportConfig sanitizes the profile at srcPath into the runtime dir and
// returns what was imported. The sanitized copy strips any system-wide
// routing, appends the pinned provider routes and the management/log/pid
// directives, and rewrites external cert/key references to local copies.
func (s *OpenVPNService) ImportConfig(srcPath string) (ImportResult, error) {
	data, err := os.ReadFile(srcPath)
	if err != nil {
		return ImportResult{}, fmt.Errorf("read openvpn config: %w", err)
	}
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return ImportResult{}, fmt.Errorf("create openvpn runtime dir: %w", err)
	}
	srcDir := filepath.Dir(srcPath)
	var kept []string
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimRight(raw, "\r")
		if strings.TrimSpace(line) == "" || droppedLine.MatchString(line) {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 && externalFile[strings.ToLower(fields[0])] && !strings.HasPrefix(fields[1], "<") {
			basename := filepath.Base(fields[1])
			if err := copyFile(filepath.Join(srcDir, fields[1]), filepath.Join(s.dir, basename)); err != nil {
				return ImportResult{}, fmt.Errorf("copy %s: %w", fields[1], err)
			}
			line = fields[0] + " " + basename
		}
		kept = append(kept, line)
	}
	if len(kept) == 0 {
		return ImportResult{}, errors.New("config file has no usable directives")
	}
	routes := 0
	for _, cidr := range providerRoutes {
		network, mask, err := cidrToRoute(cidr)
		if err != nil {
			continue
		}
		kept = append(kept, fmt.Sprintf("route %s %s vpn_gateway", network, mask))
		routes++
	}
	kept = append(kept,
		"route-nopull",
		"script-security 2",
		"auth-user-pass auth.txt",
		"management 127.0.0.1 0",
		"writepid openvpn.pid",
		"log openvpn.log",
		"verb 3",
	)
	if err := os.WriteFile(filepath.Join(s.dir, "openvpn.conf"), []byte(strings.Join(kept, "\n")+"\n"), 0600); err != nil {
		return ImportResult{}, fmt.Errorf("write sanitized config: %w", err)
	}
	server := remoteServer(data)
	s.mu.Lock()
	s.server = server
	s.mu.Unlock()
	return ImportResult{ConfigName: filepath.Base(srcPath), Server: server, Routes: routes}, nil
}

// Connect writes the credentials file and launches OpenVPN elevated (a UAC
// prompt appears once — the TUN device and its routes need elevation). It
// returns once the tunnel reports "Initialization Sequence Completed". If a
// tunnel is already up (from a previous connect or app restart), it is torn
// down first so a second OpenVPN does not collide over the TUN device.
func (s *OpenVPNService) Connect(username, password string) (Status, error) {
	if strings.TrimSpace(username) == "" || strings.TrimSpace(password) == "" {
		return Status{}, errors.New("OpenVPN/IKEv2 username and password are required")
	}
	configPath := filepath.Join(s.dir, "openvpn.conf")
	if _, err := os.Stat(configPath); err != nil {
		return Status{}, errors.New("no OpenVPN config imported — import a .ovpn file first")
	}
	// If the previous tunnel is still up, stop it first (removes routes and
	// the TUN device) so a duplicate OpenVPN doesn't collide with it.
	if err := s.Stop(); err != nil {
		return Status{}, err
	}
	if err := os.WriteFile(filepath.Join(s.dir, "auth.txt"), []byte(username+"\n"+password+"\n"), 0600); err != nil {
		return Status{}, fmt.Errorf("write credentials file: %w", err)
	}
	_ = os.Remove(filepath.Join(s.dir, "openvpn.pid"))
	_ = os.Remove(filepath.Join(s.dir, "openvpn.log"))
	bin, err := findOpenVPN()
	if err != nil {
		return Status{}, err
	}
	if err := launchElevated(bin, []string{"--cd", s.dir, "--config", "openvpn.conf"}); err != nil {
		return Status{}, err
	}
	status, err := s.waitForConnection(bin)
	if err != nil {
		_ = s.Stop()
		return Status{}, err
	}
	return status, nil
}

// Stop asks OpenVPN to shut down gracefully through its management socket
// (SIGTERM), so OpenVPN itself removes the pinned routes, then tears down the
// loopback proxy. It is robust to a missing pid file (e.g. a previous failed
// connect deleted it while the process survived): it falls back to killing any
// running openvpn.exe, which triggers OpenVPN's own route cleanup on SIGTERM.
func (s *OpenVPNService) Stop() error {
	s.mu.Lock()
	mgmtPort := s.mgmtPort
	s.mu.Unlock()
	if mgmtPort > 0 {
		if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", mgmtPort), 3*time.Second); err == nil {
			_, _ = conn.Write([]byte("signal SIGTERM\n"))
			_ = conn.Close()
		}
	}
	pid := 0
	if pidData, err := os.ReadFile(filepath.Join(s.dir, "openvpn.pid")); err == nil {
		if parsed, err := strconv.Atoi(strings.TrimSpace(string(pidData))); err == nil && parsed > 0 {
			pid = parsed
		}
	}
	if pid == 0 {
		// No pid file. Only tear down a process that provably belongs to us:
		// one that left our provider routes behind. A random openvpn.exe
		// (another app's) must not be killed.
		if providerRoutesInstalled() {
			pid = firstOpenVPNPID()
		}
	}
	if pid > 0 {
		for i := 0; i < 25 && processAlive(pid); i++ {
			time.Sleep(200 * time.Millisecond)
		}
		if processAlive(pid) {
			if !killProcess(pid) {
				// The tunnel runs elevated; a normal kill is denied. Bounce
				// through an elevated taskkill so the device is actually freed.
				killProcessElevated(pid)
				for i := 0; i < 25 && processAlive(pid); i++ {
					time.Sleep(200 * time.Millisecond)
				}
			}
		}
	}
	s.teardown()
	return nil
}

func (s *OpenVPNService) teardown() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.proxy != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		_ = s.proxy.Shutdown(ctx)
		cancel()
		s.proxy = nil
	}
	if s.listener != nil {
		_ = s.listener.Close()
		s.listener = nil
	}
	s.connected = false
	s.proxyURL = ""
	s.mgmtPort = 0
	_ = os.Remove(filepath.Join(s.dir, "auth.txt"))
}

// waitForConnection polls the OpenVPN log until the tunnel is up, a fatal
// error appears, or the timeout elapses. It fails fast when the launched
// binary never writes a log (wrong binary or a dismissed UAC prompt).
func (s *OpenVPNService) waitForConnection(bin string) (Status, error) {
	logPath := filepath.Join(s.dir, "openvpn.log")
	start := time.Now()
	deadline := start.Add(45 * time.Second)
	logSeen := false
	var tail []string
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(logPath)
		if err == nil {
			logSeen = true
			text := string(data)
			lines := strings.Split(text, "\n")
			if len(lines) > 10 {
				tail = lines[len(lines)-10:]
			}
			for _, line := range lines {
				if strings.Contains(strings.ToLower(line), "initialization sequence completed") {
					return s.bringUp(parseMgmtPort(text)), nil
				}
				if msg := fatalOpenVPNLine(line); msg != "" {
					return Status{}, errors.New(msg)
				}
			}
		}
		if !logSeen && time.Since(start) > 5*time.Second {
			return Status{}, fmt.Errorf("OpenVPN produced no output — another VPN client (Surfshark, ExpressVPN, Mullvad or OpenVPN Connect) is holding the TUN/DCO driver, or the UAC prompt was dismissed. Quit the other VPN apps, then retry")
		}
		time.Sleep(400 * time.Millisecond)
	}
	summary := strings.Join(tail, " | ")
	if summary == "" {
		summary = "no log output (did the UAC prompt get dismissed?)"
	}
	return Status{}, fmt.Errorf("openvpn did not connect within 45s (%s)", summary)
}

// bringUp starts the loopback proxy with a direct dialer. The OS now routes
// the pinned provider IPs through the tunnel, so connections from this proxy
// to those IPs leave via the VPN.
func (s *OpenVPNService) bringUp(mgmtPort int) Status {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Status{Connected: true, Mode: "openvpn", Server: s.server}
	}
	proxyServer := &http.Server{
		Handler:           &proxyHandler{dialer: &net.Dialer{Timeout: 15 * time.Second}},
		ReadHeaderTimeout: 15 * time.Second,
	}
	go func() { _ = proxyServer.Serve(listener) }()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = true
	s.listener = listener
	s.proxy = proxyServer
	s.mgmtPort = mgmtPort
	s.proxyURL = "http://" + listener.Addr().String()
	return s.snapshotLocked()
}

var mgmtRe = regexp.MustCompile(`(?i)management:\s*tcp socket listening on \[af_inet\]127\.0\.0\.1:(\d+)`)

func parseMgmtPort(text string) int {
	if match := mgmtRe.FindStringSubmatch(text); match != nil {
		if port, err := strconv.Atoi(match[1]); err == nil {
			return port
		}
	}
	return 0
}

func fatalOpenVPNLine(line string) string {
	low := strings.ToLower(line)
	for _, marker := range []string{
		"auth_failed",
		"options error",
		"cannot load",
		"insufficient privileges",
		"cannot open tun",
		"exiting due to fatal error",
		"fatal error",
	} {
		if strings.Contains(low, marker) {
			return "openvpn: " + strings.TrimSpace(line)
		}
	}
	return ""
}

func remoteServer(data []byte) string {
	re := regexp.MustCompile(`(?im)^\s*remote\s+(\S+)`)
	if match := re.FindSubmatch(data); match != nil {
		return string(match[1])
	}
	return ""
}

func readConfig(dir string) []byte {
	data, err := os.ReadFile(filepath.Join(dir, "openvpn.conf"))
	if err != nil {
		return nil
	}
	return data
}

// providerRoutesInstalled reports whether any of our pinned provider routes
// are present in the Windows IPv4 route table (used to recognize a live
// tunnel of ours when the pid file is missing).
func providerRoutesInstalled() bool {
	out, err := exec.Command("route", "print", "-4").Output()
	if err != nil {
		return false
	}
	lower := strings.ToLower(string(out))
	for _, cidr := range providerRoutes {
		network, _, parseErr := cidrToRoute(cidr)
		if parseErr != nil {
			continue
		}
		if strings.Contains(lower, network) {
			return true
		}
	}
	return false
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0600)
}
