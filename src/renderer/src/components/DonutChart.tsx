import React, { useMemo, useRef, useState } from 'react'

const darkPiePalette = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#22d3ee',
  '#fb923c',
  '#f472b6'
]
const lightPiePalette = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#ec4899'
]

interface DonutDatum {
  label: string
  value: number
  color?: string
}

interface DonutSlice extends DonutDatum {
  color: string
  start: number
  end: number
  percent: number
}

interface DonutChartProps {
  data: DonutDatum[]
  isDark: boolean
  fontSizeStep?: number
  centerLabel?: string
  activeKey?: string | null
  onActiveChange?: (key: string | null) => void
}

const TAU = Math.PI * 2

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number
): string {
  const s = start + 1e-4
  const e = end - 1e-4
  const x0 = cx + rOuter * Math.cos(s)
  const y0 = cy + rOuter * Math.sin(s)
  const x1 = cx + rOuter * Math.cos(e)
  const y1 = cy + rOuter * Math.sin(e)
  const x2 = cx + rInner * Math.cos(e)
  const y2 = cy + rInner * Math.sin(e)
  const x3 = cx + rInner * Math.cos(s)
  const y3 = cy + rInner * Math.sin(s)
  const large = e - s > Math.PI ? 1 : 0
  return [
    `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    'Z'
  ].join(' ')
}

interface Point {
  x: number
  y: number
}

function direction(midAngle: number, distance: number): Point {
  return { x: Math.cos(midAngle) * distance, y: Math.sin(midAngle) * distance }
}

export function DonutChart({
  data,
  isDark,
  fontSizeStep = 0,
  centerLabel,
  activeKey,
  onActiveChange
}: DonutChartProps): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState<Point | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const total = useMemo(() => data.reduce((sum, d) => sum + Math.max(0, d.value), 0), [data])

  const slices = useMemo(() => {
    const palette = isDark ? darkPiePalette : lightPiePalette
    const totalIn = data.reduce((sum, d) => sum + Math.max(0, d.value), 0)
    return data.reduce<DonutSlice[]>((acc2, d, i) => {
      const start = acc2.length ? acc2[acc2.length - 1].end : -Math.PI / 2
      const frac = totalIn > 0 ? Math.max(0, d.value) / totalIn : 0
      acc2.push({
        ...d,
        color: d.color ?? palette[i % palette.length],
        start,
        end: start + frac * TAU,
        percent: totalIn > 0 ? Math.round((Math.max(0, d.value) / totalIn) * 100) : 0
      })
      return acc2
    }, [])
  }, [data, isDark])

  if (data.length === 0 || total <= 0) {
    return <div className="widget-empty muted">No data to chart.</div>
  }

  const activeIndex =
    hoverIndex !== null ? hoverIndex : slices.findIndex((s) => s.label === activeKey)
  const active = activeIndex >= 0 ? slices[activeIndex] : null

  const setActive = (i: number | null): void => {
    setHoverIndex(i)
    if (i === null) onActiveChange?.(null)
    else onActiveChange?.(slices[i].label)
  }

  const handleMove = (e: React.MouseEvent): void => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const size = 240
  const cx = size / 2
  const cy = size / 2
  const rOuter = 108
  const rInner = 68

  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  const sizeStepPx = 3 * Math.max(0, fontSizeStep)

  return (
    <div className="donut-wrap" ref={containerRef}>
      <svg className="donut-svg" role="img" viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="donut-track"
          cx={cx}
          cy={cy}
          r={(rOuter + rInner) / 2}
          fill="none"
          strokeWidth={rOuter - rInner}
        />
        {slices.map((s, i) => {
          const midAngle = (s.start + s.end) / 2
          const dir = direction(midAngle, i === activeIndex ? 5 : 0)
          return (
            <path
              className={`donut-slice${activeIndex >= 0 && i !== activeIndex ? ' dimmed' : ''}`}
              key={s.label}
              d={arcPath(cx, cy, rOuter, rInner, s.start, s.end)}
              fill={s.color}
              transform={`translate(${dir.x.toFixed(2)} ${dir.y.toFixed(2)})`}
              onMouseEnter={() => setActive(i)}
              onMouseMove={handleMove}
              onMouseLeave={() => setActive(null)}
            />
          )
        })}
        <text
          className="donut-center-value"
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontSize={26 + sizeStepPx}
        >
          {active ? fmt(active.value) : fmt(total)}
        </text>
        <text
          className="donut-center-label"
          x={cx}
          y={cy + 18 + sizeStepPx / 2}
          textAnchor="middle"
          fontSize={12 + sizeStepPx / 3}
        >
          {active ? active.label : (centerLabel ?? 'Total')}
        </text>
      </svg>
      {active && tipPos && (
        <div
          className="donut-tip"
          style={tipPos ? { left: tipPos.x, top: tipPos.y } : { left: '50%', top: '18%' }}
        >
          <span className="donut-tip-swatch" style={{ background: active.color }} />
          <span className="donut-tip-label">{active.label}</span>
          <span className="donut-tip-value">
            {fmt(active.value)} · {active.percent}%
          </span>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {active ? `${active.label}: ${fmt(active.value)} (${active.percent}%)` : ''}
      </span>
    </div>
  )
}
