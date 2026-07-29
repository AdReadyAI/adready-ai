export default function RocketIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.5-.6.6-1.5.5-2.5" />
      <path d="M9 15 6.5 12.5" />
      <path d="M15 9 12.5 6.5" />
      <path d="M14.5 4.5C18 3 21 3 21 3s0 3-1.5 6.5c-1.38 3.22-4.75 6.83-7.5 8.5L6 12c1.67-2.75 5.28-6.12 8.5-7.5Z" />
      <circle cx="15" cy="9" r="1" />
    </svg>
  );
}
