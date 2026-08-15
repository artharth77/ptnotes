export interface FindRange {
  from: number
  to: number
}

export interface TextRun {
  text: string
  pos: number
}

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findMatchesInTextRuns(
  runs: TextRun[],
  query: string,
  matchCase: boolean
): FindRange[] {
  if (!query) return []

  const re = new RegExp(escapeRegex(query), matchCase ? 'gu' : 'gui')
  const results: FindRange[] = []

  for (const run of runs) {
    const matches = run.text.matchAll(re)
    for (const m of matches) {
      const text = m[0]
      if (m.index === undefined) break
      if (text.trim() === '') continue
      results.push({ from: run.pos + m.index, to: run.pos + m.index + text.length })
    }
  }

  return results
}
