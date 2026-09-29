export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ff7df" />
          <stop offset="1" stopColor="#3bc9ad" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M9 10.5c2.2-2.6 11.8-2.6 14 0" stroke="#04211c" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 12c-1.2 5 -.6 9 1.6 12.5" stroke="#04211c" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d="M20 12c1.2 5 .6 9-1.6 12.5" stroke="#04211c" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
