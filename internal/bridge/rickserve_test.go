package bridge

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"rickdesktop/internal/domain"
)

func TestDecodeStreamDeliversOrderedTypedEventsAndSkipsMalformedLines(t *testing.T) {
	input := bytes.NewBufferString("not-json\n" +
		`{"type":"event","run_id":"run-1","event":"Content","data":{"text":"hello"}}` + "\n" +
		`{"type":"done","run_id":"run-1"}` + "\n")
	var events []domain.RickEvent
	var failures []error

	count := DecodeStream(input, func(event domain.RickEvent) { events = append(events, event) }, func(err error) { failures = append(failures, err) })

	if count != 2 || len(events) != 2 {
		t.Fatalf("decoded count/events = %d/%d", count, len(events))
	}
	if events[0].Kind != domain.EventTextDelta || events[1].Kind != domain.EventRunCompleted {
		t.Fatalf("unexpected event kinds: %+v", events)
	}
	if len(failures) != 1 || !errors.Is(failures[0], ErrMalformedLine) {
		t.Fatalf("expected one malformed-line error, got %v", failures)
	}
}

func TestEncodeRequestWritesOneNDJSONLine(t *testing.T) {
	var output bytes.Buffer
	if err := EncodeRequest(&output, map[string]any{"type": "models"}); err != nil {
		t.Fatal(err)
	}
	if !bytes.HasSuffix(output.Bytes(), []byte("\n")) {
		t.Fatalf("request does not end with newline: %q", output.String())
	}
	var request map[string]string
	if err := json.Unmarshal(bytes.TrimSpace(output.Bytes()), &request); err != nil {
		t.Fatal(err)
	}
	if request["type"] != "models" {
		t.Fatalf("unexpected request: %+v", request)
	}
}

func TestDecodeModelsSupportsBareArrayAndWrappedShapes(t *testing.T) {
	bare := json.RawMessage(`{"type":"models","data":[{"provider":"openai","id":"gpt-5","name":"GPT-5","context_window":400000}]}`)
	models, err := DecodeModels(bare)
	if err != nil {
		t.Fatalf("bare array: %v", err)
	}
	if len(models) != 1 || models[0].ID != "gpt-5" {
		t.Fatalf("bare array decoded wrong: %+v", models)
	}
	if !IsConfiguredModel(models[0]) {
		t.Fatalf("bare-array model should be treated as configured: %+v", models[0])
	}

	wrapped := json.RawMessage(`{"type":"models","data":{"models":[{"provider":"openai","id":"gpt-5","name":"GPT-5","context_window":400000,"source":"configured","configured":true}]}}`)
	models, err = DecodeModels(wrapped)
	if err != nil {
		t.Fatalf("wrapped: %v", err)
	}
	if len(models) != 1 || models[0].ID != "gpt-5" {
		t.Fatalf("wrapped decoded wrong: %+v", models)
	}

	errorResponse := json.RawMessage(`{"type":"error","error":"boom"}`)
	if _, err := DecodeModels(errorResponse); err == nil {
		t.Fatal("expected error response to fail")
	}
}

func TestDecodeTools(t *testing.T) {
	raw := json.RawMessage(`{"type":"tools","data":[{"name":"read","description":"Read a file."},{"name":"task","description":"Delegate work."}]}`)
	tools, err := DecodeTools(raw)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(tools) != 2 || tools[0].Name != "read" || tools[1].Name != "task" || tools[1].Description == "" {
		t.Fatalf("decoded wrong: %+v", tools)
	}

	empty := json.RawMessage(`{"type":"tools","data":[]}`)
	tools, err = DecodeTools(empty)
	if err != nil || len(tools) != 0 {
		t.Fatalf("empty list: tools=%v err=%v", tools, err)
	}

	errorResponse := json.RawMessage(`{"type":"error","error":"boom"}`)
	if _, err := DecodeTools(errorResponse); err == nil {
		t.Fatal("expected error response to fail")
	}
}
