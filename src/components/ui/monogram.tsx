import { extractInitials } from "@/lib/extract-initials";
import { getContrastingTextColor } from "@/lib/color-contrast";

interface MonogramProps {
  companyName: string;
  brandColor?: string;
  size?: number;
}

const DEFAULT_BRAND_COLOR = "#004225";

export function Monogram({ companyName, brandColor, size = 48 }: MonogramProps) {
  const initials = extractInitials(companyName);
  const bgColor = brandColor || DEFAULT_BRAND_COLOR;
  const textColor = getContrastingTextColor(bgColor);

  // If no initials (empty/invalid company name), render a placeholder
  if (!initials) {
    return (
      <div
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: bgColor,
        }}
        aria-label="Company logo"
      >
        <svg
          width={size * 0.5}
          height={size * 0.5}
          viewBox="0 0 24 24"
          fill="none"
          stroke={textColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
        fontSize: size * 0.4,
      }}
      aria-label={`${companyName} logo`}
    >
      <span style={{ color: textColor }}>{initials}</span>
    </div>
  );
}
