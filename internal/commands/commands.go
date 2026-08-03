package commands

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"

	"rickdesktop/internal/domain"
)

type Parsed struct {
	Name string
	Args []string
}

type Result struct {
	Command  string `json:"command"`
	ExitCode int    `json:"exit_code"`
	Output   string `json:"output"`
}

func Parse(line string) (Parsed, error) {
	tokens := tokenize(line)
	if len(tokens) == 0 {
		return Parsed{}, errors.New("command is empty")
	}
	name := strings.TrimPrefix(tokens[0], "/")
	if name == "" || strings.ContainsAny(name, "\\/:;") {
		return Parsed{}, fmt.Errorf("invalid command %q", tokens[0])
	}
	return Parsed{Name: name, Args: tokens[1:]}, nil
}

func Find(parsed Parsed, catalog []domain.CommandSpec) (domain.CommandSpec, bool) {
	for _, command := range catalog {
		if strings.EqualFold(command.Name, parsed.Name) {
			return command, true
		}
		for _, alias := range command.Aliases {
			if strings.EqualFold(alias, parsed.Name) {
				return command, true
			}
		}
	}
	return domain.CommandSpec{}, false
}

func Execute(ctx context.Context, line string, approved bool, path string, catalog []domain.CommandSpec) (Result, error) {
	parsed, err := Parse(line)
	if err != nil {
		return Result{}, err
	}
	spec, ok := Find(parsed, catalog)
	if !ok {
		return Result{}, fmt.Errorf("unknown Rick command %q", parsed.Name)
	}
	if spec.Dangerous && !approved {
		return Result{}, fmt.Errorf("command %q requires explicit approval", spec.Name)
	}
	command := newCommandContext(ctx, path, append([]string{spec.Name}, parsed.Args...)...)
	output, runErr := command.CombinedOutput()
	result := Result{Command: strings.Join(append([]string{spec.Name}, parsed.Args...), " "), Output: strings.TrimSpace(string(output))}
	if runErr != nil {
		if exitError, ok := runErr.(*exec.ExitError); ok {
			result.ExitCode = exitError.ExitCode()
		} else {
			result.ExitCode = -1
		}
		return result, fmt.Errorf("rick %s: %w", result.Command, runErr)
	}
	return result, nil
}

func tokenize(input string) []string {
	var tokens []string
	var current strings.Builder
	var quote rune
	escaped := false
	flush := func() {
		if current.Len() > 0 {
			tokens = append(tokens, current.String())
			current.Reset()
		}
	}
	for _, char := range input {
		if escaped {
			current.WriteRune(char)
			escaped = false
			continue
		}
		if char == '\\' && quote != '\'' {
			escaped = true
			continue
		}
		if quote != 0 {
			if char == quote {
				quote = 0
			} else {
				current.WriteRune(char)
			}
			continue
		}
		if char == '\'' || char == '"' {
			quote = char
		} else if char == ' ' || char == '\t' || char == '\n' || char == '\r' {
			flush()
		} else {
			current.WriteRune(char)
		}
	}
	if escaped {
		current.WriteRune('\\')
	}
	flush()
	return tokens
}
