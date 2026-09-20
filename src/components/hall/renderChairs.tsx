export function renderChairs(seats: number, cx: number, cy: number, radius: number) {
  return Array.from({ length: seats }, (_, index) => {
    const angle = (index / seats) * Math.PI * 2 - Math.PI / 2;
    return (
      <circle
        key={index}
        cx={cx + Math.cos(angle) * radius}
        cy={cy + Math.sin(angle) * radius}
        r="5"
        fill="#e2e8f0"
        stroke="#94a3b8"
      />
    );
  });
}
