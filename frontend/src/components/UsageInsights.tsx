import { useState } from 'react';
import { Activity, Layers3 } from 'lucide-react';
import { DailyUsage, SessionUsage } from '../lib/types';

interface UsageInsightsProps {
    daily: DailyUsage[];
    total: SessionUsage;
}

function formatTokens(value: number) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return new Intl.NumberFormat().format(value || 0);
}

function shortDate(value: string) {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function fullDate(value: string) {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function TokenValue({ label, value, className }: { label: string; value: number; className: string }) {
    return <div className="flex items-center justify-between gap-4 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><span className={`h-2 w-2 rounded-sm ${className}`} />{label}</span><span className="font-medium tabular-nums text-foreground">{formatTokens(value)}</span></div>;
}

export function UsageInsights({ daily, total }: UsageInsightsProps) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const maximum = Math.max(1, ...daily.map(day => day.input + day.output + day.cached));

    return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
        <section className="usage-chart-panel">
            <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                    <div className="eyebrow"><Activity size={13} /> Usage activity</div>
                    <h3 className="mt-1 text-sm font-semibold text-foreground">Tokens used per active day</h3>
                </div>
                <div className="usage-chart-legend"><span><i className="bg-muted-foreground" />Input</span><span><i className="bg-foreground/60" />Output</span><span><i className="bg-foreground/30" />Cached</span></div>
            </div>
            {daily.length === 0 ? <div className="flex h-52 items-center justify-center rounded-md border border-dashed border-border bg-muted text-center text-xs text-muted-foreground">No daily usage records yet.<br />Your activity chart appears after Rick records a run.</div> : <div className="relative"><div className="usage-chart-grid" aria-hidden="true"><span /><span /><span /><span /></div><div className="relative flex h-52 items-end gap-2 px-1 pt-3">{daily.map((day, index) => {
                const sum = day.input + day.output + day.cached;
                const active = index === hoveredIndex;
                return <button key={day.date} type="button" onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(current => current === index ? null : current)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(current => current === index ? null : current)} className={`usage-bar-group ${active ? 'is-active' : ''}`} aria-label={`${fullDate(day.date)}: ${formatTokens(sum)} tokens`}><span className="usage-bar" style={{ height: `${Math.max(sum ? 6 : 0, (sum / maximum) * 100)}%` }}><i className="bg-muted-foreground" style={{ height: `${sum ? (day.input / sum) * 100 : 0}%` }} /><i className="bg-foreground/60" style={{ height: `${sum ? (day.output / sum) * 100 : 0}%` }} /><i className="bg-foreground/30" style={{ height: `${sum ? (day.cached / sum) * 100 : 0}%` }} /></span><span className="mt-2 whitespace-nowrap text-[10px] text-muted-foreground">{shortDate(day.date)}</span>{active && <UsageTooltip day={day} />}</button>;
            })}</div></div>}
        </section>
        <section className="usage-chart-panel flex flex-col justify-between">
            <div><div className="eyebrow"><Layers3 size={13} /> All time</div><h3 className="mt-1 text-sm font-semibold text-foreground">Token mix</h3></div>
            <div className="my-5 flex items-center gap-4"><div className="usage-donut"><div><strong>{formatTokens(total.total)}</strong><span>total</span></div></div><div className="min-w-0 flex-1 space-y-2"><TokenValue label="Input" value={total.input} className="bg-muted-foreground" /><TokenValue label="Output" value={total.output} className="bg-foreground/60" /><TokenValue label="Cached" value={total.cached} className="bg-foreground/30" /></div></div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">Cached tokens are shown separately from billed input and output totals.</p>
        </section>
    </div>;
}

function UsageTooltip({ day }: { day: DailyUsage }) {
    return <div className="usage-chart-tooltip" role="status"><div className="mb-2 border-b border-border pb-2"><div className="text-xs font-semibold text-foreground">{fullDate(day.date)}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{formatTokens(day.total)} processed tokens</div></div><div className="space-y-2">{day.models.map(model => <div key={model.model} className="rounded-md border border-border bg-muted p-2"><div className="truncate text-[11px] font-medium text-foreground" title={model.model}>{model.model}</div><div className="mt-1 grid grid-cols-3 gap-2 text-[10px] tabular-nums text-muted-foreground"><span>In {formatTokens(model.input)}</span><span>Out {formatTokens(model.output)}</span><span>Cache {formatTokens(model.cached)}</span></div></div>)}</div></div>;
}
