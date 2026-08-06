package nvpn

import (
	"net"
	"strings"
)

// providerRoutes are the IP blocks that the AI provider APIs Rick Desktop
// talks to resolve to. Only traffic to these ranges is routed through the
// OpenVPN tunnel (strict split tunnel); everything else stays on the normal
// connection. The providers sit behind CDNs whose ranges rotate, so this is a
// curated starting point: extend it when a provider changes ranges, and keep
// it as narrow as practical to avoid routing unrelated CDN traffic.
var providerRoutes = []string{
	"23.235.32.0/20", // OpenAI (api.openai.com)
	"104.18.0.0/16",  // OpenAI / Anthropic / OpenRouter (Cloudflare)
	"172.64.0.0/16",  // Anthropic / OpenRouter (Cloudflare)
	"104.16.0.0/16",  // xAI / Mistral (Cloudflare)
	"142.250.0.0/16", // Google (generativelanguage.googleapis.com)
	"172.217.0.0/16", // Google (generativelanguage.googleapis.com)
}

// cidrToRoute converts a CIDR block into the dotted network and mask OpenVPN's
// "route" directive expects.
func cidrToRoute(cidr string) (network, mask string, err error) {
	_, ipNet, err := net.ParseCIDR(strings.TrimSpace(cidr))
	if err != nil {
		return "", "", err
	}
	return ipNet.IP.String(), net.IP(ipNet.Mask).String(), nil
}
