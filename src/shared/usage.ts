import type { TokenUsage } from './types'

/**
 * Pure token-usage helpers — normalize provider usage payloads (chat.completions
 * and Responses API shapes) and sum them. No imports beyond types.
 */

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Normalize a raw provider usage object into { input, output, cached }.
 * Handles chat.completions (`prompt_tokens` / `completion_tokens` /
 * `prompt_tokens_details.cached_tokens`) and the Responses API
 * (`input_tokens` / `output_tokens` / `input_tokens_details.cached_tokens`).
 * Returns null when no token counts are present.
 */
export function normalizeUsage(usage: unknown): TokenUsage | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  const input = num(u.prompt_tokens ?? u.input_tokens)
  const output = num(u.completion_tokens ?? u.output_tokens)
  if (input === undefined && output === undefined) return null
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as
    Record<string, unknown> | undefined
  const cached = num(details?.cached_tokens)
  return {
    input: input ?? 0,
    output: output ?? 0,
    ...(cached !== undefined ? { cached } : {})
  }
}

/** Sum two usages (either may be undefined). */
export function addUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  const cached = (a?.cached ?? 0) + (b.cached ?? 0)
  return {
    input: (a?.input ?? 0) + b.input,
    output: (a?.output ?? 0) + b.output,
    ...(cached > 0 ? { cached } : {})
  }
}

/** Total usage across messages; null when none carry usage. */
export function sumUsage(msgs: { usage?: TokenUsage }[]): TokenUsage | null {
  let total: TokenUsage | undefined
  for (const m of msgs) {
    if (m.usage) total = addUsage(total, m.usage)
  }
  return total ?? null
}

/** Compact token count for the status bar: 999 → "999", 12345 → "12.3k". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
