import { describe, expect, it } from 'vitest';
import mainSource from './main.tsx?raw';

describe('startup error boundary', () => {
  it('does not replace the mounted application from a global error listener', () => {
    expect(mainSource).not.toContain("window.addEventListener('error'");
    expect(mainSource).toContain('AppErrorBoundary');
  });
});
