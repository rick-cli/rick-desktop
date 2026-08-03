package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type EventKind string

const (
	EventRunStarted     EventKind = "run.started"
	EventTextDelta      EventKind = "text.delta"
	EventReasoningDelta EventKind = "reasoning.delta"
	EventToolStarted    EventKind = "tool.started"
	EventToolProgress   EventKind = "tool.progress"
	EventToolApproval   EventKind = "tool.approval"
	EventPermissionAsk  EventKind = "permission.requested"
	EventToolCompleted  EventKind = "tool.completed"
	EventToolFailed     EventKind = "tool.failed"
	EventSwarmStarted   EventKind = "swarm.started"
	EventAgentUpdated   EventKind = "agent.updated"
	EventSwarmCompleted EventKind = "swarm.completed"
	EventUsage          EventKind = "usage"
	EventRunCompleted   EventKind = "run.completed"
	EventRunCancelled   EventKind = "run.cancelled"
	EventRunFailed      EventKind = "run.failed"
	EventUnknown        EventKind = "unknown"
)

type Usage struct {
	InputTokens      int `json:"input_tokens,omitempty"`
	OutputTokens     int `json:"output_tokens,omitempty"`
	CacheReadTokens  int `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens int `json:"cache_write_tokens,omitempty"`
	CachedTokens     int `json:"cached_tokens,omitempty"`
	TotalTokens      int `json:"total_tokens,omitempty"`
	ContextTokens    int `json:"context_tokens,omitempty"`
	ContextLimit     int `json:"context_limit,omitempty"`
}

type RickEvent struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id,omitempty"`
	RunID     string          `json:"run_id,omitempty"`
	SessionID string          `json:"session_id,omitempty"`
	MessageID string          `json:"message_id,omitempty"`
	AgentID   string          `json:"agent_id,omitempty"`
	SwarmID   string          `json:"swarm_id,omitempty"`
	RawName   string          `json:"raw_name,omitempty"`
	Kind      EventKind       `json:"kind"`
	Sequence  int64           `json:"sequence"`
	Timestamp time.Time       `json:"timestamp,omitempty"`
	Text      string          `json:"text,omitempty"`
	Error     string          `json:"error,omitempty"`
	Usage     *Usage          `json:"usage,omitempty"`
	RawData   json.RawMessage `json:"raw_data,omitempty"`
	Raw       json.RawMessage `json:"raw,omitempty"`
}

type eventEnvelope struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id"`
	RunID     string          `json:"run_id"`
	SessionID string          `json:"session_id"`
	MessageID string          `json:"message_id"`
	AgentID   string          `json:"agent_id"`
	SwarmID   string          `json:"swarm_id"`
	Event     string          `json:"event"`
	Sequence  json.RawMessage `json:"sequence"`
	Timestamp string          `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
	Error     string          `json:"error"`
}

func DecodeRickEvent(raw []byte, fallbackSequence int64) (RickEvent, error) {
	var envelope eventEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return RickEvent{}, fmt.Errorf("decode rick event: %w", err)
	}
	if envelope.Type == "" {
		return RickEvent{}, fmt.Errorf("decode rick event: missing type")
	}

	sequence := fallbackSequence
	if len(envelope.Sequence) > 0 && string(envelope.Sequence) != "null" {
		if parsed, err := strconv.ParseInt(string(envelope.Sequence), 10, 64); err == nil {
			sequence = parsed
		}
	}
	timestamp := time.Time{}
	if envelope.Timestamp != "" {
		timestamp, _ = time.Parse(time.RFC3339Nano, envelope.Timestamp)
	}

	rawName := envelope.Event
	kind := classifyEvent(envelope.Type, rawName, envelope.Error)
	event := RickEvent{
		Type:      envelope.Type,
		RequestID: envelope.RequestID,
		RunID:     envelope.RunID,
		SessionID: envelope.SessionID,
		MessageID: envelope.MessageID,
		AgentID:   envelope.AgentID,
		SwarmID:   envelope.SwarmID,
		RawName:   rawName,
		Kind:      kind,
		Sequence:  sequence,
		Timestamp: timestamp,
		Error:     envelope.Error,
		RawData:   cloneRaw(envelope.Data),
		Raw:       cloneRaw(raw),
	}

	if kind == EventTextDelta || kind == EventReasoningDelta {
		event.Text = dataString(envelope.Data, "text", "content", "delta")
	}
	if kind == EventRunFailed && event.Error == "" {
		event.Error = dataString(envelope.Data, "error", "message")
	}
	if kind == EventUsage {
		event.Usage = decodeUsage(envelope.Data)
	}
	if kind == EventUnknown && envelope.Type == "error" && event.Error == "" {
		event.Error = dataString(envelope.Data, "error", "message")
	}
	return event, nil
}

func classifyEvent(envelopeType, name, errorText string) EventKind {
	if envelopeType == "done" || strings.EqualFold(name, "done") {
		return EventRunCompleted
	}
	if envelopeType == "cancelled" || strings.EqualFold(name, "cancelled") {
		return EventRunCancelled
	}
	if envelopeType == "error" {
		return EventRunFailed
	}
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(name, "_", "."), "-", "."))
	normalized = strings.TrimPrefix(normalized, "event.")
	switch normalized {
	case "run.started", "started", "start":
		return EventRunStarted
	case "content", "text", "text.delta", "content.delta", "delta":
		return EventTextDelta
	case "reasoning", "thinking", "reasoning.delta", "thinking.delta":
		return EventReasoningDelta
	case "tool.started", "tool.start", "tool.call", "tool.called", "tooluse":
		return EventToolStarted
	case "tool.progress", "tool.output":
		return EventToolProgress
	case "tool.approval", "approval", "approval.requested":
		return EventToolApproval
	case "permission.request", "permission.requested", "permission", "permissionrequest":
		return EventPermissionAsk
	case "tool.completed", "tool.complete", "tool.result", "tool.finished", "toolresult":
		return EventToolCompleted
	case "tool.failed", "tool.error":
		return EventToolFailed
	case "swarm.started", "team.started":
		return EventSwarmStarted
	case "agent.updated", "agent.started", "agent.completed", "agent.result":
		return EventAgentUpdated
	case "swarm.completed", "team.completed", "swarm.finished":
		return EventSwarmCompleted
	case "usage", "tokens", "usage.updated":
		return EventUsage
	case "cancelled", "canceled", "run.cancelled", "run.canceled":
		return EventRunCancelled
	case "failed", "run.failed", "error":
		return EventRunFailed
	}
	if errorText != "" {
		return EventRunFailed
	}
	return EventUnknown
}

func dataString(raw json.RawMessage, keys ...string) string {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	object, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range keys {
		if text, ok := object[key].(string); ok {
			return text
		}
	}
	return ""
}

func decodeUsage(raw json.RawMessage) *Usage {
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	if nested, ok := value["usage"].(map[string]any); ok {
		for key, nestedValue := range nested {
			value[key] = nestedValue
		}
	}
	usage := &Usage{
		InputTokens:      firstNumber(value, "input_tokens", "input", "prompt_tokens", "prompt"),
		OutputTokens:     firstNumber(value, "output_tokens", "output", "completion_tokens", "completion"),
		CacheReadTokens:  firstNumber(value, "cache_read_tokens", "cache_read", "cached_tokens", "cached"),
		CacheWriteTokens: firstNumber(value, "cache_write_tokens", "cache_write"),
		TotalTokens:      firstNumber(value, "total_tokens", "total"),
		ContextTokens:    firstNumber(value, "context_tokens", "context_used", "prompt_tokens"),
		ContextLimit:     firstNumber(value, "context_limit", "context_window", "max_context_tokens"),
	}
	if details, ok := value["prompt_tokens_details"].(map[string]any); ok && usage.CacheReadTokens == 0 {
		usage.CacheReadTokens = firstNumber(details, "cached_tokens", "cache_read")
	}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
	}
	if usage.CachedTokens == 0 {
		usage.CachedTokens = usage.CacheReadTokens + usage.CacheWriteTokens
	}
	if usage.ContextTokens == 0 {
		usage.ContextTokens = usage.InputTokens
	}
	if usage.InputTokens == 0 && usage.OutputTokens == 0 && usage.CachedTokens == 0 && usage.ContextTokens == 0 && usage.ContextLimit == 0 {
		return nil
	}
	return usage
}

func firstNumber(value map[string]any, keys ...string) int {
	for _, key := range keys {
		switch number := value[key].(type) {
		case float64:
			return int(number)
		case int:
			return number
		case json.Number:
			parsed, _ := number.Int64()
			return int(parsed)
		}
	}
	return 0
}

func cloneRaw(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	return bytes.Clone(raw)
}
