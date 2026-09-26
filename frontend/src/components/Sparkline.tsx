export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 24 - ((v - min) / range) * 22 - 1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
