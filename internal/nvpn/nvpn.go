// Package nvpn implements the NVPN extension: it connects to a NordVPN
// server's SOCKS5 proxy using the user's service credentials, then exposes a
// local HTTP proxy (CONNECT + plain HTTP) that tunnels through it. The app's
// rickserve process is spawned with HTTP_PROXY/HTTPS_PROXY/ALL_PROXY pointing
// at that local proxy, so only Rick Desktop's own traffic is routed.
package nvpn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/proxy"
)

// nordAPI is the public endpoint that returns the recommended (fastest)
// servers; no authentication is required.
const nordAPI = "https://api.nordvpn.com/v1/servers/recommendations?limit=1"

// socksPort is the standard NordVPN SOCKS5 proxy port.
const socksPort = "1080"

// ipEcho is used to discover the exit IP through the tunnel.
const ipEcho = "https://api.ipify.org?format=json"

// Status is the connection state surfaced to the UI.
type Status struct {
	Connected bool   `json:"connected"`
	Mode      string `json:"mode"`
	Server    string `json:"server"`
	Country   string `json:"country"`
	City      string `json:"city"`
	SocksHost string `json:"socks_host"`
	IP        string `json:"ip"`
	ProxyURL  string `json:"proxy_url"`
}

// OpenVPNSettings is the persisted OpenVPN-mode configuration (password never
// leaves Go).
type OpenVPNSettings struct {
	Username    string `json:"username"`
	ConfigName  string `json:"config_name"`
	HasPassword bool   `json:"has_password"`
	AutoConnect bool   `json:"auto_connect"`
}

// Settings is the persisted NVPN configuration (password never leaves Go).
type Settings struct {
	Username    string          `json:"username"`
	HasPassword bool            `json:"has_password"`
	AutoConnect bool            `json:"auto_connect"`
	OpenVPN     OpenVPNSettings `json:"openvpn"`
}

// Service owns a single NordVPN tunnel.
type Service struct {
	mu         sync.Mutex
	connected  bool
	serverName string
	country    string
	city       string
	socksHost  string
	exitIP     string
	listener   net.Listener
	server     *http.Server
	proxyURL   string
}

// New returns an idle NVPN service.
func New() *Service { return &Service{} }

// ProxyURL returns the local HTTP proxy URL, or "" when not connected. Used
// to build the rickserve environment.
func (s *Service) ProxyURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.proxyURL
}

// Status returns a snapshot of the connection state.
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *Service) snapshotLocked() Status {
	return Status{
		Connected: s.connected,
		Mode:      "socks5",
		Server:    s.serverName,
		Country:   s.country,
		City:      s.city,
		SocksHost: s.socksHost,
		IP:        s.exitIP,
		ProxyURL:  s.proxyURL,
	}
}

type recommendation struct {
	Name      string `json:"name"`
	Country   string `json:"-"`
	City      string `json:"-"`
	Locations []struct {
		Country struct {
			Code string `json:"code"`
			City struct {
				DNSName string `json:"dns_name"`
			} `json:"city"`
		} `json:"country"`
	} `json:"locations"`
}

// Connect picks the recommended (fastest) NordVPN server and starts the
// tunnel through its SOCKS5 proxy. Credentials are NordVPN service
// credentials (from the dashboard's "Set up manually" page), not the login
// email/password.
func (s *Service) Connect(username, password string) (Status, error) {
	if strings.TrimSpace(username) == "" || strings.TrimSpace(password) == "" {
		return Status{}, errors.New("NVPN service credentials are required")
	}
	server, err := s.fetchRecommended()
	if err != nil {
		return Status{}, err
	}
	socksHost := s.socksHostFor(server)
	socksAddr := net.JoinHostPort(socksHost, socksPort)

	auth := &proxy.Auth{User: username, Password: password}
	dialer, err := proxy.SOCKS5("tcp", socksAddr, auth, proxy.Direct)
	if err != nil {
		return Status{}, fmt.Errorf("build socks5 dialer: %w", err)
	}
	// The SOCKS5 dialer only validates the address format; prove the proxy
	// accepts the credentials with a TCP connection attempt.
	probe, err := dialer.Dial("tcp", "8.8.8.8:53")
	if err != nil {
		return Status{}, fmt.Errorf("NVPN proxy rejected the connection (check credentials): %w", err)
	}
	_ = probe.Close()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Status{}, fmt.Errorf("open local proxy: %w", err)
	}
	handler := &proxyHandler{dialer: dialer}
	proxyServer := &http.Server{Handler: handler, ReadHeaderTimeout: 15 * time.Second}
	go func() { _ = proxyServer.Serve(listener) }()

	exitIP, _ := s.exitIPThrough(listener.Addr().String())

	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
	s.connected = true
	s.serverName = server.Name
	s.country = server.Country
	s.city = server.City
	s.socksHost = socksHost
	s.exitIP = exitIP
	s.listener = listener
	s.server = proxyServer
	s.proxyURL = "http://" + listener.Addr().String()
	return s.snapshotLocked(), nil
}

// Stop tears the tunnel down. The rickserve process is restarted separately
// by the App so its environment (and therefore its traffic) goes direct again.
func (s *Service) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
	return nil
}

func (s *Service) stopLocked() {
	if s.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		_ = s.server.Shutdown(ctx)
		cancel()
		s.server = nil
	}
	if s.listener != nil {
		_ = s.listener.Close()
		s.listener = nil
	}
	s.connected = false
	s.serverName = ""
	s.country = ""
	s.city = ""
	s.socksHost = ""
	s.exitIP = ""
	s.proxyURL = ""
}

// Reconnect stops any active tunnel and connects again to the recommended
// server.
func (s *Service) Reconnect(username, password string) (Status, error) {
	s.Stop()
	return s.Connect(username, password)
}

func (s *Service) fetchRecommended() (*recommendation, error) {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(nordAPI)
	if err != nil {
		return nil, fmt.Errorf("fetch recommended server: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch recommended server: status %d", resp.StatusCode)
	}
	var servers []recommendation
	if err := json.NewDecoder(resp.Body).Decode(&servers); err != nil {
		return nil, fmt.Errorf("decode recommended server: %w", err)
	}
	if len(servers) == 0 {
		return nil, errors.New("no recommended servers returned")
	}
	server := &servers[0]
	if len(server.Locations) > 0 {
		location := server.Locations[0]
		server.Country = location.Country.Code
		server.City = location.Country.City.DNSName
	}
	return server, nil
}

// socksHostFor maps a server to its NordVPN SOCKS5 hostname, e.g.
// "frankfurt.de.socks.nordhold.net".
func (s *Service) socksHostFor(server *recommendation) string {
	if server.City != "" && server.Country != "" {
		return fmt.Sprintf("%s.%s.socks.nordhold.net", server.City, strings.ToLower(server.Country))
	}
	if server.Country != "" {
		return fmt.Sprintf("%s.socks.nordhold.net", strings.ToLower(server.Country))
	}
	return "us.socks.nordhold.net"
}

func (s *Service) exitIPThrough(localProxy string) (string, error) {
	proxyURL := "http://" + localProxy
	client := &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyURL(mustParseURL(proxyURL))},
		Timeout:   20 * time.Second,
	}
	resp, err := client.Get(ipEcho)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var payload struct {
		IP string `json:"ip"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	return payload.IP, nil
}

func mustParseURL(raw string) *url.URL {
	parsed, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return parsed
}
