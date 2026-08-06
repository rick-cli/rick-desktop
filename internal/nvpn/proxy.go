package nvpn

import (
	"context"
	"io"
	"net"
	"net/http"

	"golang.org/x/net/proxy"
)

// proxyHandler is a minimal local HTTP proxy. HTTPS clients (including the
// rickserve process, via HTTPS_PROXY) send CONNECT tunnels; plain HTTP
// requests are forwarded directly. Both paths dial through the NordVPN SOCKS5
// proxy.
type proxyHandler struct {
	dialer proxy.Dialer
}

func (h *proxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		h.handleConnect(w, r)
		return
	}
	h.handleForward(w, r)
}

// handleConnect upgrades the request into a raw tunnel to r.Host.
func (h *proxyHandler) handleConnect(w http.ResponseWriter, r *http.Request) {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}
	client, _, err := hijacker.Hijack()
	if err != nil {
		return
	}
	target, err := h.dialer.Dial("tcp", r.Host)
	if err != nil {
		_ = client.Close()
		return
	}
	if _, err := client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		_ = target.Close()
		_ = client.Close()
		return
	}
	go func() {
		_, _ = io.Copy(target, client)
		_ = target.Close()
	}()
	_, _ = io.Copy(client, target)
	_ = client.Close()
}

// handleForward proxies a plain (non-CONNECT) HTTP request.
func (h *proxyHandler) handleForward(w http.ResponseWriter, r *http.Request) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return h.dialer.Dial(network, addr)
		},
	}
	defer transport.CloseIdleConnections()
	outgoing := r.Clone(r.Context())
	outgoing.RequestURI = ""
	outgoing.URL.Scheme = "http"
	outgoing.URL.Host = r.Host
	resp, err := transport.RoundTrip(outgoing)
	if err != nil {
		http.Error(w, "proxy error: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
