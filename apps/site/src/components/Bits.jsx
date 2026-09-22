/** Small shared pieces: section shell, stat, and the SVG plan used in the hero. */

export function Section({ id, eyebrow, title, lead, children }) {
  return (
    <section id={id} className="mx-auto max-w-6xl px-5 py-16">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-400">{eyebrow}</p>}
      {title && <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h2>}
      {lead && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">{lead}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function Stat({ value, label }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="block text-2xl font-semibold text-white">{value}</span>
        <span className="text-xs text-zinc-500">{label}</span>
      </dd>
    </div>
  );
}

/**
 * The hero illustration: a real 3 BHK layout drawn as SVG rather than a
 * screenshot, so it stays sharp, weighs nothing, and cannot go stale when the
 * app's UI changes.
 */
export function PlanPreview({ className = '' }) {
  const rooms = [
    { x: 4, y: 4, w: 78, h: 62, label: 'Master Bed', fill: '#6b5b95' },
    { x: 82, y: 4, w: 36, h: 34, label: 'Bath', fill: '#4a8a9a' },
    { x: 82, y: 38, w: 36, h: 28, label: 'Bath', fill: '#4a8a9a' },
    { x: 118, y: 4, w: 64, h: 62, label: 'Bedroom 2', fill: '#6b5b95' },
    { x: 182, y: 4, w: 58, h: 62, label: 'Kids', fill: '#6b5b95' },
    { x: 4, y: 66, w: 236, h: 18, label: 'Passage', fill: '#8a8a80' },
    { x: 4, y: 84, w: 136, h: 62, label: 'Living & Dining', fill: '#4a68a6' },
    { x: 140, y: 84, w: 56, h: 62, label: 'Kitchen', fill: '#8a7a4a' },
    { x: 196, y: 84, w: 44, h: 62, label: 'Utility', fill: '#5f7a63' },
  ];
  const furniture = [
    [16, 12, 30, 22], [52, 10, 12, 14], [10, 40, 14, 24],
    [128, 12, 26, 20], [162, 12, 12, 12], [122, 44, 10, 18],
    [190, 12, 18, 26], [216, 40, 18, 12],
    [16, 96, 44, 16], [24, 120, 30, 14], [70, 92, 40, 24], [96, 122, 34, 16],
    [146, 92, 12, 20], [146, 120, 12, 18], [176, 132, 14, 10],
    [206, 92, 14, 12], [206, 122, 16, 14],
  ];

  return (
    <svg viewBox="0 0 244 150" className={'h-auto w-full rounded-xl bg-[#0a0d13] ' + className} role="img" aria-label="Example 3 BHK floor plan">
      <defs>
        <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M8 0H0V8" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="244" height="150" fill="url(#grid)" />
      {rooms.map((r) => (
        <g key={r.label + r.x}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} fillOpacity="0.25" />
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#d8dbe1" strokeWidth="1.6" />
          <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 2} textAnchor="middle" fontSize="4.6" fill="#cbd5e1">
            {r.label}
          </text>
        </g>
      ))}
      {furniture.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="1.5" fill="#94a3b8" fillOpacity="0.55" />
      ))}
      {/* Openings drawn as gaps in the wall line */}
      {[
        [40, 66, 14], [130, 66, 12], [200, 66, 12], [30, 84, 16], [160, 84, 12],
      ].map(([x, y, w], i) => (
        <rect key={'d' + i} x={x} y={y - 1.2} width={w} height="2.6" fill="#0a0d13" />
      ))}
    </svg>
  );
}
