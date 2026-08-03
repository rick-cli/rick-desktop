package sessions

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Store struct {
	dir string
}

type TokenUsage struct {
	Input      int `json:"input"`
	Output     int `json:"output"`
	CacheRead  int `json:"cache_read"`
	CacheWrite int `json:"cache_write"`
}

func (u TokenUsage) Cached() int { return u.CacheRead + u.CacheWrite }

type Summary struct {
	ID       string     `json:"id"`
	Title    string     `json:"title"`
	CWD      string     `json:"cwd"`
	Model    string     `json:"model"`
	Messages int        `json:"messages"`
	Created  string     `json:"created"`
	Updated  string     `json:"updated"`
	Category string     `json:"category,omitempty"`
	Favorite bool       `json:"favorite,omitempty"`
	Usage    TokenUsage `json:"usage"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type storedSession struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	CWD      string            `json:"cwd"`
	Model    string            `json:"model"`
	Created  string            `json:"created"`
	Updated  string            `json:"updated"`
	Category string            `json:"category,omitempty"`
	Favorite bool              `json:"favorite,omitempty"`
	Usage    TokenUsage        `json:"usage"`
	Messages []json.RawMessage `json:"messages"`
}

func NewStore(dir string) *Store { return &Store{dir: dir} }
func (s *Store) Dir() string     { return s.dir }

// metaFile mirrors rick's lightweight .meta.json listing entry so the desktop
// shares the same fast listing path as the CLI instead of parsing every full
// session file on each refresh.
type metaFile struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	CWD      string `json:"cwd"`
	Model    string `json:"model"`
	Messages int    `json:"messages"`
	Created  string `json:"created"`
	Updated  string `json:"updated"`
	Category string `json:"category,omitempty"`
	Favorite bool   `json:"favorite,omitempty"`
}

func (s *Store) List() ([]Summary, error) {
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		return []Summary{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read session directory: %w", err)
	}
	summaries := make([]Summary, 0, len(entries))
	known := make(map[string]struct{}, len(entries))
	legacy := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(entry.Name(), ".meta.json") {
			summary, ok := s.readMeta(entry.Name())
			if !ok {
				continue
			}
			summaries = append(summaries, summary)
			known[summary.ID] = struct{}{}
			continue
		}
		if filepath.Ext(entry.Name()) == ".json" && entry.Name() != "current.json" {
			legacy = append(legacy, entry)
		}
	}
	for _, entry := range legacy {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if _, ok := known[id]; ok {
			continue
		}
		session, err := s.read(entry.Name())
		if err != nil || session.ID == "" {
			continue
		}
		summaries = append(summaries, summaryFrom(session))
	}
	sort.SliceStable(summaries, func(i, j int) bool { return summaries[i].Updated > summaries[j].Updated })
	return summaries, nil
}

func (s *Store) readMeta(filename string) (Summary, bool) {
	raw, err := os.ReadFile(filepath.Join(s.dir, filename))
	if err != nil {
		return Summary{}, false
	}
	var meta metaFile
	if json.Unmarshal(raw, &meta) != nil || meta.ID == "" {
		return Summary{}, false
	}
	return Summary{ID: meta.ID, Title: meta.Title, CWD: meta.CWD, Model: meta.Model, Messages: meta.Messages, Created: meta.Created, Updated: meta.Updated, Category: meta.Category, Favorite: meta.Favorite}, true
}

// writeMeta refreshes the lightweight listing file after a desktop-side
// mutation, keeping it consistent with rick's fast List path.
func (s *Store) writeMeta(id string, value map[string]any) error {
	meta := metaFile{
		ID:       id,
		Title:    stringValue(value, "title"),
		CWD:      stringValue(value, "cwd"),
		Model:    stringValue(value, "model"),
		Category: stringValue(value, "category"),
	}
	if rawMessages, ok := value["messages"].([]any); ok {
		meta.Messages = len(rawMessages)
	} else {
		meta.Messages = intValue(value, "messages")
	}
	meta.Created = stringValue(value, "created")
	meta.Updated = stringValue(value, "updated")
	if meta.Updated == "" {
		meta.Updated = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if meta.Created == "" {
		meta.Created = meta.Updated
	}
	meta.Favorite = boolValue(value, "favorite")
	payload, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir, id+".meta.json")
	temporary, err := os.CreateTemp(s.dir, ".meta-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(append(payload, '\n')); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func stringValue(value map[string]any, key string) string {
	text, _ := value[key].(string)
	return text
}

func intValue(value map[string]any, key string) int {
	number, _ := value[key].(float64)
	return int(number)
}

func boolValue(value map[string]any, key string) bool {
	flag, _ := value[key].(bool)
	return flag
}

// summaryFrom builds a listing entry, filling in a date-based category for
// sessions that have no explicit category.
func summaryFrom(session storedSession) Summary {
	title := session.Title
	if title == "" {
		title = "Untitled session"
	}
	category := session.Category
	if category == "" {
		category = dateCategory(session.Created)
	}
	return Summary{ID: session.ID, Title: title, CWD: session.CWD, Model: session.Model, Messages: len(session.Messages), Created: session.Created, Updated: session.Updated, Category: category, Favorite: session.Favorite, Usage: session.Usage}
}

// dateCategory buckets a creation timestamp into Today / Yesterday / This
// week / This month / Older, so new sessions are grouped sensibly by default.
func dateCategory(created string) string {
	parsed, err := time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return "Older"
	}
	today := startOfDay(time.Now())
	day := startOfDay(parsed)
	switch {
	case day.Equal(today):
		return "Today"
	case day.Equal(today.AddDate(0, 0, -1)):
		return "Yesterday"
	case day.After(today.AddDate(0, 0, -7)):
		return "This week"
	case day.After(today.AddDate(0, -1, 0)):
		return "This month"
	default:
		return "Older"
	}
}

func startOfDay(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, value.Location())
}

func (s *Store) Messages(id string) ([]Message, error) {
	session, err := s.read(id + ".json")
	if err != nil {
		return nil, err
	}
	messages := make([]Message, 0, len(session.Messages))
	for _, raw := range session.Messages {
		var value struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		if err := json.Unmarshal(raw, &value); err != nil {
			continue
		}
		messages = append(messages, Message{Role: value.Role, Content: contentText(value.Content)})
	}
	return messages, nil
}

func (s *Store) Rename(id, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return errors.New("session title cannot be empty")
	}
	_, err := s.mutateSession(id, func(value map[string]any) { value["title"] = title })
	return err
}

// SetCategory assigns a human-readable category. An empty value clears the
// explicit category so the date-based default applies again.
func (s *Store) SetCategory(id, category string) error {
	category = strings.TrimSpace(category)
	_, err := s.mutateSession(id, func(value map[string]any) {
		if category == "" {
			delete(value, "category")
		} else {
			value["category"] = category
		}
	})
	return err
}

// SetFavorite marks a session as a favourite.
func (s *Store) SetFavorite(id string, fav bool) error {
	_, err := s.mutateSession(id, func(value map[string]any) { value["favorite"] = fav })
	return err
}

// mutateSession loads a session as a generic map, applies the mutation, then
// persists both the session file and its lightweight listing entry.
func (s *Store) mutateSession(id string, apply func(value map[string]any)) (map[string]any, error) {
	value, err := s.loadSessionMap(id)
	if err != nil {
		return nil, err
	}
	apply(value)
	if err := s.saveSessionMap(id, value); err != nil {
		return nil, err
	}
	return value, nil
}

func (s *Store) loadSessionMap(id string) (map[string]any, error) {
	raw, err := s.readRaw(id)
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("decode session: %w", err)
	}
	return value, nil
}

func (s *Store) saveSessionMap(id string, value map[string]any) error {
	if err := s.writeRaw(id, value); err != nil {
		return err
	}
	return s.writeMeta(id, value)
}

// Delete removes a session file.
func (s *Store) Delete(id string) error {
	if !validID(id) {
		return errors.New("invalid session identifier")
	}
	path := filepath.Join(s.dir, id+".json")
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	_ = os.Remove(filepath.Join(s.dir, id+".meta.json"))
	return nil
}

func (s *Store) Fork(id string) (Summary, error) {
	value, err := s.loadSessionMap(id)
	if err != nil {
		return Summary{}, err
	}
	newID := fmt.Sprintf("fork-%d", time.Now().UnixNano())
	value["id"] = newID
	title, _ := value["title"].(string)
	if title == "" {
		title = "Untitled session"
	}
	value["title"] = title + " (fork)"
	now := time.Now().UTC().Format(time.RFC3339Nano)
	value["created"] = now
	value["updated"] = now
	if err := s.saveSessionMap(newID, value); err != nil {
		return Summary{}, err
	}
	session, err := s.read(newID + ".json")
	if err != nil {
		return Summary{}, err
	}
	return summaryFrom(session), nil
}

func (s *Store) Search(query string) ([]Summary, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return s.List()
	}
	all, err := s.List()
	if err != nil {
		return nil, err
	}
	results := make([]Summary, 0)
	for _, summary := range all {
		if strings.Contains(strings.ToLower(summary.Title), query) || strings.Contains(strings.ToLower(summary.Model), query) {
			results = append(results, summary)
			continue
		}
		messages, err := s.Messages(summary.ID)
		if err != nil {
			continue
		}
		for _, message := range messages {
			if strings.Contains(strings.ToLower(message.Content), query) {
				results = append(results, summary)
				break
			}
		}
	}
	return results, nil
}

func (s *Store) Export(id string) ([]byte, error) {
	raw, err := s.readRaw(id)
	if err != nil {
		return nil, err
	}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, raw, "", "  "); err != nil {
		return nil, fmt.Errorf("format session export: %w", err)
	}
	pretty.WriteByte('\n')
	return pretty.Bytes(), nil
}

func (s *Store) Import(path, source string) (Summary, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	if source == "" {
		source = "auto"
	}
	switch source {
	case "auto", "json", "markdown", "md", "plaintext", "text", "transcript":
	default:
		return Summary{}, fmt.Errorf("unknown import source %q (want auto, json, markdown, plaintext or transcript)", source)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return Summary{}, fmt.Errorf("read session import: %w", err)
	}

	value, err := parseImportedSession(raw, source)
	if err != nil {
		return Summary{}, err
	}
	id, _ := value["id"].(string)
	if !validID(id) {
		id = fmt.Sprintf("import-%d", time.Now().UnixNano())
	}
	value["id"] = id
	if err := s.saveSessionMap(id, value); err != nil {
		return Summary{}, err
	}
	session, err := s.read(id + ".json")
	if err != nil {
		return Summary{}, err
	}
	return summaryFrom(session), nil
}

// parseImportedSession decodes session JSON, or a markdown/plaintext
// transcript, into a canonical session map. The source "auto" tries JSON
// first and falls back to markdown.
func parseImportedSession(raw []byte, source string) (map[string]any, error) {
	asJSON := func() (map[string]any, error) {
		var value map[string]any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		return value, nil
	}
	switch source {
	case "json":
		return asJSON()
	case "markdown", "md", "plaintext", "text", "transcript":
		return transcriptToSession(raw), nil
	default: // auto
		if value, err := asJSON(); err == nil {
			return value, nil
		}
		return transcriptToSession(raw), nil
	}
}

// transcriptToSession converts a markdown/plaintext transcript into a
// session-shaped map. Lines beginning with "## User" / "## Assistant" (or
// "> User" / "> Assistant") start a new message; everything else is appended
// to the current message.
func transcriptToSession(raw []byte) map[string]any {
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	type turn struct {
		role    string
		content []string
	}
	var turns []turn
	appendTurn := func(role, line string) {
		turns = append(turns, turn{role: role, content: []string{line}})
	}
	for _, line := range lines {
		lower := strings.ToLower(line)
		switch {
		case strings.HasPrefix(lower, "## user"), strings.HasPrefix(lower, "> user"), strings.HasPrefix(lower, "user:"):
			appendTurn("user", stripRolePrefix(line))
		case strings.HasPrefix(lower, "## assistant"), strings.HasPrefix(lower, "> assistant"), strings.HasPrefix(lower, "assistant:"):
			appendTurn("assistant", stripRolePrefix(line))
		case strings.HasPrefix(lower, "## system"), strings.HasPrefix(lower, "> system"), strings.HasPrefix(lower, "system:"):
			appendTurn("system", stripRolePrefix(line))
		default:
			if len(turns) == 0 {
				appendTurn("user", line)
			} else {
				turns[len(turns)-1].content = append(turns[len(turns)-1].content, line)
			}
		}
	}
	messages := make([]map[string]any, 0, len(turns))
	for _, turn := range turns {
		text := strings.TrimSpace(strings.Join(turn.content, "\n"))
		if text == "" {
			continue
		}
		messages = append(messages, map[string]any{
			"role":    turn.role,
			"content": text,
		})
	}
	if len(messages) == 0 {
		return map[string]any{"messages": []map[string]any{}}
	}
	title := ""
	if first, ok := messages[0]["content"].(string); ok {
		for _, line := range strings.Split(first, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			title = line
			if len(title) > 80 {
				title = title[:80]
			}
			break
		}
	}
	return map[string]any{"title": title, "messages": messages}
}

func stripRolePrefix(line string) string {
	for _, prefix := range []string{"## ", "> ", "User:", "Assistant:", "System:", "user:", "assistant:", "system:"} {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return strings.TrimSpace(line)
}

func (s *Store) read(filename string) (storedSession, error) {
	if !validFilename(filename) {
		return storedSession{}, errors.New("invalid session identifier")
	}
	raw, err := os.ReadFile(filepath.Join(s.dir, filename))
	if err != nil {
		return storedSession{}, fmt.Errorf("read session: %w", err)
	}
	var session storedSession
	if err := json.Unmarshal(raw, &session); err != nil {
		return storedSession{}, fmt.Errorf("decode session: %w", err)
	}
	return session, nil
}

func (s *Store) readRaw(id string) ([]byte, error) {
	if !validID(id) {
		return nil, errors.New("invalid session identifier")
	}
	raw, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if err != nil {
		return nil, fmt.Errorf("read session: %w", err)
	}
	return raw, nil
}

func (s *Store) writeRaw(id string, value map[string]any) error {
	if !validID(id) {
		return errors.New("invalid session identifier")
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return fmt.Errorf("create sessions directory: %w", err)
	}
	path := filepath.Join(s.dir, id+".json")
	temporary, err := os.CreateTemp(s.dir, ".session-*.tmp")
	if err != nil {
		return fmt.Errorf("create session temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(payload, '\n')); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace session: %w", err)
	}
	return nil
}

func validID(id string) bool {
	return id != "" && id != "." && id != ".." && filepath.Base(id) == id && !strings.ContainsAny(id, `/\\`)
}

func validFilename(filename string) bool {
	return strings.HasSuffix(filename, ".json") && validID(strings.TrimSuffix(filename, ".json"))
}

func contentText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		var builder strings.Builder
		for _, block := range blocks {
			if block.Type == "text" || block.Type == "" {
				builder.WriteString(block.Text)
			}
		}
		return builder.String()
	}
	return ""
}
