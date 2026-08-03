// @ts-nocheck
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('flat enterprise design system', () => {
  it('uses no decorative depth effects', () => {
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/i);
    expect(css).not.toMatch(/backdrop-filter\s*:/i);
    expect(css).not.toMatch(/--[\w-]*(?:glow|shadow)[\w-]*\s*:/i);

    const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)].map(match => match[1].trim());
    expect(shadows.every(value => value === 'none' || value === 'none !important')).toBe(true);
  });

  it('uses one solid blue primary accent and the required typefaces', () => {
    expect(css).toContain('--primary: #2f81f7;');
    expect(css).not.toContain('#2563eb');
    expect(css).toMatch(/--font-sans:\s*"JetBrains Mono"/);
    expect(css).toMatch(/--font-mono:\s*"JetBrains Mono"/);

    const primaryDeclarations = [...css.matchAll(/--primary\s*:\s*([^;]+);/g)].map(match => match[1].trim());
    expect(new Set(primaryDeclarations)).toEqual(new Set(['#2f81f7']));
  });

  it('keeps status and diff tokens monochromatic', () => {
    expect(css).toContain('--destructive: #484f58;');
    expect(css).toContain('--dot-warning: #8b949e;');
    expect(css).toContain('--diff-add-sign: #8b949e;');
    expect(css).toContain('--diff-del-sign: #8b949e;');
    expect(css).not.toMatch(/#(?:f85149|d29922|3fb950|aff5b4|12261a|ffdcd7|2d1518)/i);
  });

  it('defines the coding workspace shell', () => {
    for (const className of [
      'app-shell',
      'reference-sidebar',
      'workspace-context',
      'reference-chat',
      'codex-timeline',
      'codex-composer-shell',
      'reference-composer',
    ]) {
      expect(css).toContain(`.${className}`);
    }
  });

  it('applies Graphite as the initial root theme and exposes complete semantic tokens', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const sidebar = readFileSync(resolve(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');

    expect(html).toMatch(/<html[^>]+data-theme="graphite"/);
    expect(css).toContain('[data-theme="dracula"]');
    for (const token of ['--background:', '--foreground:', '--popover:', '--border:', '--sidebar:', '--surface-2:', '--text-message:']) {
      expect(css).toContain(`${token}`);
    }
    expect(app).toContain('applyTheme(patch.theme)');
    expect(app).toContain("let lastDarkTheme: DesktopConfig['theme'] = 'graphite';");
    expect(app).toContain('overflow-visible');
    expect(app).not.toContain('Environment ready');
    expect(app).not.toContain('title="Toggle light / dark theme"');
    expect(app).not.toContain('ThinkingSelector value={desktopConfig?.thinking_mode');
    expect(sidebar).not.toContain('❯');
    expect(css).toContain('.wordmark { color: var(--foreground); font-size: 17px; font-weight: 700;');
  });
});
