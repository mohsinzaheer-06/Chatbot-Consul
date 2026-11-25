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
      {/* Precision octagonal crest */}
      <path
        d="M12 2.25L19.75 6.75V17.25L12 21.75L4.25 17.25V6.75L12 2.25Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {/* Stylized C-arc + celestial four-point intelligence star */}
      <path
        d="M15.4 8.6A4.75 4.75 0 1 0 15.4 15.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M15.75 9.6L16.35 11.4L18.15 12L16.35 12.6L15.75 14.4L15.15 12.6L13.35 12L15.15 11.4L15.75 9.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
