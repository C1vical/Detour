import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Svg({ className = "size-4", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const NavigationIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 11 18-8-8 18-2-8z" />
  </Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const RulerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17 17 3l4 4L7 21z" />
    <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
  </Svg>
);
export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const RainIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 9 3.5 3.5 0 0 1 17 15z" />
    <path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" />
  </Svg>
);
export const CloudIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 12a3 3 0 0 1-1 6z" />
  </Svg>
);
export const MountainIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 20 6-10 4 6 2-3 6 7z" />
  </Svg>
);
export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Svg>
);
export const TreeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22v-6" />
    <path d="M12 3 6 11h3l-4 5h14l-4-5h3z" />
  </Svg>
);
export const UmbrellaIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 0 1 18 0z" />
    <path d="M12 12v7a2 2 0 0 0 4 0M12 3V2" />
  </Svg>
);
export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);
export const SwapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />
  </Svg>
);
export const FlaskIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" />
    <path d="M7 15h10" />
  </Svg>
);
export const ConeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 4h5l4.5 15h-14z" />
    <path d="M3 20h18M7.5 11h9M6 15h12" />
  </Svg>
);
export const SunriseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v3M5.6 8.6 7 10M18.4 8.6 17 10M3 16h2M19 16h2M7 16a5 5 0 0 1 10 0M3 20h18" />
  </Svg>
);
export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />
  </Svg>
);
export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const BulbIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12 5 5L20 7" />
  </Svg>
);
