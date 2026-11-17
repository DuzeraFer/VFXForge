import type { ReactElement } from "react"

const PATHS = {
  logo: <path d="M3 3h10v10H3zM8 3v10" />,
  select: <path d="M4 2.5l8 5.5-3.6.8L10.5 13l-1.6.7-2-4.2L4 12z" />,
  pan: <path d="M8 2v12M2 8h12M8 2L6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" />,
  frame: <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />,
  comment: <path d="M2.5 3.5h11v7.5H8l-3 2.5V11H2.5z" />,
  reroute: (
    <>
      <path d="M2 11.5h3.5l5-7H14" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  measure: <path d="M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3" />,
  chevron: <path d="M4 6l4 4 4-4" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  doc: <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />,
  home: <path d="M2.5 8L8 3l5.5 5M4 7v6h8V7" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 116.5 3 4.5 4.5 0 0013 9.5z" />,
  prev: <path d="M11 3.5v9L5 8zM4.5 3.5v9" />,
  next: <path d="M5 3.5v9L11 8zM11.5 3.5v9" />,
  play: <path d="M5 3l8 5-8 5z" />,
  tile: <path d="M2.5 2.5h11v11h-11zM8 2.5v11M2.5 8h11" />,
  pin: <path d="M6 2.5h4l-.5 4 2 2.5h-7l2-2.5zM8 9v4.5" />,
  plus: <path d="M8 3v10M3 8h10" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  dice: (
    <>
      <path d="M3 3h10v10H3z" />
      <circle cx="6" cy="6" r="0.5" />
      <circle cx="10" cy="10" r="0.5" />
      <circle cx="8" cy="8" r="0.5" />
    </>
  ),
  trash: <path d="M3.5 4.5h9M6.5 4.5v-2h3v2M5 4.5l.5 8.5h5l.5-8.5" />,
  link: <path d="M7 9a2.5 2.5 0 003.5 0l2-2A2.5 2.5 0 009 3.5l-.8.8M9 7a2.5 2.5 0 00-3.500 0l-2 2A2.500 2.500 0 007 12.500l.8-.8" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r="0.6" />
      <circle cx="8" cy="8" r="0.6" />
      <circle cx="12.5" cy="8" r="0.6" />
    </>
  )
} as const satisfies Record<string, ReactElement>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
