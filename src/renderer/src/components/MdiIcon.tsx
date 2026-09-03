export function MdiIcon({
  path,
  size = 18,
  className,
  style
}: {
  path: string
  size?: number
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}
