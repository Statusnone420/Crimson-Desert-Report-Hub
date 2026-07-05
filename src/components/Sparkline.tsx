export function Sparkline({
  points,
  width = 640,
  height = 60,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const stepX = width / (points.length - 1);
  const path = points
    .map((point, index) => {
      const x = (index * stepX).toFixed(1);
      const y = (height - (point / max) * (height - 4) - 2).toFixed(1);
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Reports per day, last 30 days">
      <path
        d={path}
        fill="none"
        stroke="var(--crimson)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
