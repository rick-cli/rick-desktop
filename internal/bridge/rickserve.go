package bridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"rickdesktop/internal/domain"
)

var ErrMalformedLine = errors.New("malformed rickserve line")

var requestCounter uint64

func NewRequestID(prefix string) string {
	sequence := atomic.AddUint64(&requestCounter, 1)
	return fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixNano(), sequence)
}

func EncodeRequest(writer io.Writer, request any) error {
	payload, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode rickserve request: %w", err)
	}
	payload = append(payload, '\n')
	if _, err := writer.Write(payload); err != nil {
		return fmt.Errorf("write rickserve request: %w", err)
	}
	return nil
}

func DecodeStream(reader io.Reader, onEvent func(domain.RickEvent), onError func(error)) int {
	if onEvent == nil {
		onEvent = func(domain.RickEvent) {}
	}
	if onError == nil {
		onError = func(error) {}
	}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	sequence := int64(0)
	count := 0
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		sequence++
		event, err := domain.DecodeRickEvent(line, sequence)
		if err != nil {
			onError(fmt.Errorf("%w at sequence %d: %v", ErrMalformedLine, sequence, err))
			continue
		}
		count++
		onEvent(event)
	}
	if err := scanner.Err(); err != nil {
		onError(fmt.Errorf("read rickserve stream: %w", err))
	}
	return count
}

type EventSink func(domain.RickEvent)
type ErrorSink func(error)

type Service struct {
	path    string
	onEvent EventSink
	onError ErrorSink

	mu       sync.Mutex
	command  *exec.Cmd
	stdin    io.WriteCloser
	stopping bool
}

func NewService(path string, onEvent EventSink, onError ErrorSink) *Service {
	if strings.TrimSpace(path) == "" {
		path = "rickserve"
	}
	return &Service{path: path, onEvent: onEvent, onError: onError}
}

func (s *Service) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.command != nil {
		return nil
	}

	command := newCommand(s.path)
	stdin, err := command.StdinPipe()
	if err != nil {
		return fmt.Errorf("open rickserve stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return fmt.Errorf("open rickserve stdout: %w", err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		return fmt.Errorf("open rickserve stderr: %w", err)
	}
	if err := command.Start(); err != nil {
		_ = stdin.Close()
		return fmt.Errorf("start rickserve: %w", err)
	}
	s.command = command
	s.stdin = stdin
	s.stopping = false

	go DecodeStream(stdout, s.onEvent, s.onError)
	go func() {
		_, _ = io.Copy(io.Discard, stderr)
	}()
	go func() {
		err := command.Wait()
		s.mu.Lock()
		intentional := s.stopping
		if s.command == command {
			s.command = nil
			s.stdin = nil
		}
		s.mu.Unlock()
		if err != nil && !intentional && s.onError != nil {
			s.onError(fmt.Errorf("rickserve exited: %w", err))
		}
	}()
	return nil
}

func (s *Service) Send(request any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stdin == nil {
		return errors.New("rickserve is not running")
	}
	return EncodeRequest(s.stdin, request)
}

func (s *Service) Stop() error {
	s.mu.Lock()
	command := s.command
	stdin := s.stdin
	if command == nil {
		s.mu.Unlock()
		return nil
	}
	s.stopping = true
	s.command = nil
	s.stdin = nil
	s.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if command.Process != nil {
		if err := command.Process.Kill(); err != nil {
			return fmt.Errorf("stop rickserve: %w", err)
		}
	}
	return nil
}

func (s *Service) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.command != nil
}

func OneShot(ctx context.Context, path string, request any) ([]json.RawMessage, error) {
	if strings.TrimSpace(path) == "" {
		path = "rickserve"
	}
	command := newContextCommand(ctx, path)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("open rickserve stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("open rickserve stdout: %w", err)
	}
	if err := command.Start(); err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("start rickserve: %w", err)
	}
	if err := EncodeRequest(stdin, request); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return nil, err
	}
	// Ask rickserve to drain in-flight work and exit. Without this it returns
	// as soon as stdin closes, so a handler dispatched on its own goroutine
	// (every request type) can lose its response — the models/config/plugins
	// queries then come back empty or not at all.
	if err := EncodeRequest(stdin, map[string]any{"type": "shutdown"}); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return nil, err
	}
	_ = stdin.Close()

	var responses []json.RawMessage
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var header struct {
			Type string `json:"type"`
		}
		// Skip handshake/bookkeeping lines so callers see the real response.
		if json.Unmarshal(line, &header) == nil && (header.Type == "ready" || header.Type == "done") {
			continue
		}
		responses = append(responses, append(json.RawMessage(nil), line...))
	}
	waitErr := command.Wait()
	if err := scanner.Err(); err != nil {
		return responses, fmt.Errorf("read rickserve response: %w", err)
	}
	if waitErr != nil {
		return responses, fmt.Errorf("rickserve request exited: %w", waitErr)
	}
	return responses, nil
}
