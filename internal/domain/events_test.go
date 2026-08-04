package domain

import (
	"encoding/json"
	"testing"
)

func TestDecodeRickEventPreservesCorrelationAndUnknownPayload(t *testing.T) {
	raw := []byte(`{"type":"event","request_id":"req-1","run_id":"run-1","session_id":"session-1","event":"FutureEvent","sequence":9,"data":{"preserved":true}}`)

	event, err := DecodeRickEvent(raw, 1)
	if err != nil {
		t.Fatalf("DecodeRickEvent() error = %v", err)
	}
	if event.RequestID != "req-1" || event.RunID != "run-1" || event.SessionID != "session-1" {
		t.Fatalf("correlation IDs were not preserved: %+v", event)
	}
	if event.Sequence != 9 || event.Kind != EventUnknown || event.RawName != "FutureEvent" {
		t.Fatalf("unexpected event metadata: %+v", event)
	}
	var payload map[string]bool
	if err := json.Unmarshal(event.RawData, &payload); err != nil || !payload["preserved"] {
		t.Fatalf("raw payload was not preserved: %s", event.RawData)
	}
}

func TestDecodeRickEventNormalizesLegacyContentAndDone(t *testing.T) {
	content, err := DecodeRickEvent([]byte(`{"type":"event","session_id":"s","event":"Content","data":{"text":"hello"}}`), 1)
	if err != nil {
		t.Fatal(err)
	}
	if content.Kind != EventTextDelta || content.Text != "hello" {
		t.Fatalf("unexpected content event: %+v", content)
	}

	done, err := DecodeRickEvent([]byte(`{"type":"done","session_id":"s"}`), 2)
	if err != nil {
		t.Fatal(err)
	}
	if done.Kind != EventRunCompleted || done.Sequence != 2 {
		t.Fatalf("unexpected done event: %+v", done)
	}
}

func TestDecodeRickEventClassifiesRickserveEventNames(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want EventKind
	}{
		{"tool use", `{"type":"event","event":"ToolUse","data":{"name":"read","input":{}}}`, EventToolStarted},
		{"tool result", `{"type":"event","event":"ToolResult","data":{"name":"read","output":"x"}}`, EventToolCompleted},
		{"swarm start", `{"type":"event","event":"SwarmStart","data":{"agents":2,"goal":"g","name":"moon-facts"}}`, EventSwarmStarted},
		{"swarm tool use", `{"type":"event","event":"ToolUse","data":{"name":"swarm","input":{"action":"spawn"}}}`, EventSwarmStarted},
		{"team tool use", `{"type":"event","event":"ToolUse","data":{"name":"team","input":{"action":"complete_task"}}}`, EventAgentUpdated},
		{"team tool result", `{"type":"event","event":"ToolResult","data":{"name":"team","output":"task completed"}}`, EventAgentUpdated},
		{"swarm tool result", `{"type":"event","event":"ToolResult","data":{"name":"swarm","output":"Swarm done"}}`, EventSwarmCompleted},
		{"permission request", `{"type":"event","event":"PermissionRequest","data":{"request_id":"r1","command":"rm -rf /"}}`, EventPermissionAsk},
		{"cancelled", `{"type":"cancelled","session_id":"s"}`, EventRunCancelled},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			event, err := DecodeRickEvent([]byte(tc.raw), 1)
			if err != nil {
				t.Fatal(err)
			}
			if event.Kind != tc.want {
				t.Fatalf("Kind = %q, want %q", event.Kind, tc.want)
			}
		})
	}
}
