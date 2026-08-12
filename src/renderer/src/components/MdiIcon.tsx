export function MdiIcon({
  path,
  size = 18,
  className
}: {
  path: string
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      className={className}
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
