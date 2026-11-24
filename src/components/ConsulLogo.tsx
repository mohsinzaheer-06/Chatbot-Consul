interface ConsulLogoProps {
  className?: string;
}

export function ConsulLogo({ className = 'h-5 w-5' }: ConsulLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="6"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M14.75 9.25A4 4 0 1 0 14.75 14.75"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="15.5" cy="12" r="1.25" fill="currentColor" />
    </svg>
  );
}
