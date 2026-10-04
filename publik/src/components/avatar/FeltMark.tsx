/** Laurel mark. Not a character, and not a stand-in for the missing plush art. */
export function FeltMark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 32 32" width={size}>
      <rect fill="#fffdf8" height="32" rx="10" width="32" />
      <path d="M16 7c-2.4 2.2-4 4.8-4 8.2 0 2.2.8 4 2.2 5.2" fill="none" stroke="#0c3f86" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M16 7c2.4 2.2 4 4.8 4 8.2 0 2.2-.8 4-2.2 5.2" fill="none" stroke="#0c3f86" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M16 20.4v5" fill="none" stroke="#ff6f61" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
