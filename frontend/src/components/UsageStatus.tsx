import { ArrowDownToLine, ArrowUpFromLine, Database, Gauge, Percent } from 'lucide-react';

export interface SessionTokens {
  input: number;
  output: number;
  cached: number;
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat().format(value || 0);
}

export function cacheHitPercent(input: number, cached: number): number {
  const uncachedInput = Math.max(0, input);
  const cachedInput = Math.max(0, cached);
  const promptTokens = uncachedInput + cachedInput;
  return promptTokens > 0 ? (cachedInput / promptTokens) * 100 : 0;
}

export function UsageStatus({ tokens, contextUsed, contextLimit }: { tokens: SessionTokens; contextUsed: number; contextLimit: number }) {
  const hasLimit = contextLimit > 0;
  const percent = hasLimit ? Math.min(100, (contextUsed / contextLimit) * 100) : 0;
  // Share of the prompt fed from cache: cached / (input + cached). Higher is
  // better; a fresh context starts near 0% and rises on subsequent turns.
  const cacheHit = cacheHitPercent(tokens.input, tokens.cached);
  return (
    <div className="usage-status">
      <span className="usage-token" title="Input tokens">
        <ArrowDownToLine size={13} />
        <span>{formatTokens(tokens.input)}</span>
      </span>
      <span className="usage-token" title="Output tokens">
        <ArrowUpFromLine size={13} />
        <span>{formatTokens(tokens.output)}</span>
      </span>
      <span className="usage-token usage-token-cached" title="Cached tokens">
        <Database size={13} />
        <span>{formatTokens(tokens.cached)}</span>
      </span>
      <span className="usage-token usage-token-cache-hit" title="Cache hit rate — share of the prompt served from cache">
        <Percent size={13} />
        <span>{cacheHit.toFixed(0)}%</span>
      </span>
      {hasLimit && (
        <span className="usage-context" title={`Context window: ${formatTokens(contextUsed)} of ${formatTokens(contextLimit)} tokens`}>
          <Gauge size={13} />
          <span>{formatTokens(contextUsed)}/{formatTokens(contextLimit)}</span>
          <span className="usage-context-bar">
            <span className="usage-context-fill" style={{ width: `${percent}%` }} />
          </span>
        </span>
      )}
    </div>
  );
}
