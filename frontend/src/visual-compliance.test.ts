import { describe, expect, it } from 'vitest';

const sourceModules = import.meta.glob('./**/*.{ts,tsx}', {
    eager: true,
    import: 'default',
    query: '?raw',
}) as Record<string, string>;

const sources = Object.entries(sourceModules)
    .filter(([path]) => !/\.(?:test|spec)\.tsx?$/.test(path))
    .map(([path, content]) => ({ path, content }));
const logoSource = sourceModules['./components/RickLogo.tsx'];

describe('flat interface source', () => {
    it.each(sources)('$path does not request gradients, blur, or shadows', ({ content }) => {
        expect(content).not.toMatch(/(?:linear|radial|conic)Gradient|(?:linear|radial|conic)-gradient/i);
        expect(content).not.toMatch(/backdrop-blur|shadow-(?:sm|md|lg|xl|2xl|\[)/i);
    });

    it.each(sources)('$path stays neutral apart from the primary token', ({ content }) => {
        expect(content).not.toMatch(/(?:red|green|amber|yellow|orange|emerald|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/i);
        expect(content).not.toMatch(/#[0-9a-f]{3,8}/i);
    });

    it('keeps the product mark flat and single-accent', () => {
        expect(logoSource).toContain('var(--primary)');
        expect(logoSource).not.toMatch(/#[0-9a-f]{3,8}/i);
    });
});
