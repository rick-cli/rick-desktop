package nvpn

import "testing"

func TestSocksHostFor(t *testing.T) {
	service := &Service{}
	cases := []struct {
		server *recommendation
		want   string
	}{
		{&recommendation{Country: "DE", City: "frankfurt"}, "frankfurt.de.socks.nordhold.net"},
		{&recommendation{Country: "US", City: "san-francisco"}, "san-francisco.us.socks.nordhold.net"},
		{&recommendation{Country: "DE"}, "de.socks.nordhold.net"},
		{&recommendation{}, "us.socks.nordhold.net"},
	}
	for _, tc := range cases {
		if got := service.socksHostFor(tc.server); got != tc.want {
			t.Errorf("socksHostFor(%+v) = %q, want %q", tc.server, got, tc.want)
		}
	}
}
