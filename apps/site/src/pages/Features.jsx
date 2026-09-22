import { Section } from '../components/Bits.jsx';
import { TrialButton } from '../App.jsx';

const GROUPS = [
  {
    title: 'Drawing',
    items: [
      ['Walls, doors, windows, rooms', 'Click to draw with live snapping to the grid, to endpoints and to edges. Doors and windows are cut into the wall properly, in both views.'],
      ['Measure and box-select', 'Measure any two points, drag a marquee over a region, nudge with the arrow keys, and undo every step exactly.'],
      ['Multiple floors', 'Stack floors at real elevations, hide any of them in the 3D view, and switch between them without losing your place.'],
    ],
  },
  {
    title: 'Navigation, borrowed from Blender',
    items: [
      ['Middle-drag orbits, Shift+middle pans', 'The muscle memory 3D users already have. Right-drag pans too, and holding Space pans with any tool active.'],
      ['Zoom to the cursor', 'The wheel zooms toward whatever is under the pointer, easing in rather than jumping a fixed step.'],
      ['G / R / S with axis locks', 'Grab, rotate and scale from the keyboard. Press X or Y to lock an axis, type a number for an exact value, Esc to cancel.'],
      ['Numpad viewpoints', '1 front, 3 right, 7 top, 9 back, 5 perspective, and . to frame the selection — each an eased flight rather than a jump cut.'],
    ],
  },
  {
    title: 'Furnishing',
    items: [
      ['70+ pieces at real dimensions', 'Beds, sofas, wardrobes and dining sets, plus the pieces most tools forget: washing machine, dishwasher, chimney hood, split AC, ceiling fan, geyser, pooja unit, bunk bed.'],
      ['Materials and lighting', 'Wood, stone, metal, fabric, glass and paint finishes, with daylight, evening, warm and studio lighting presets.'],
      ['Clash checking', 'Furniture that cuts through a wall or blocks a doorway is flagged as you work, with chairs understood to belong under tables.'],
    ],
  },
  {
    title: 'Sharing with clients',
    items: [
      ['Read-only by design', 'A client link carries its role inside a signed token. There is no editing UI, and the model layer refuses changes even if one were forced through.'],
      ['Watermark, expiry, passcode', 'Stamp the recipient name across the view, set the link to expire, and require a passcode before it opens.'],
      ['No exports, no printing', 'Downloads and snapshots are removed for view-only links, and printing produces a notice instead of the drawing.'],
      ['Activity log', 'See when a link was opened and whether anyone tried to capture or print it.'],
    ],
  },
];

export default function Features() {
  return (
    <>
      <Section
        eyebrow="Features"
        title="Built for the way design work actually moves"
        lead="Drafting, visualising and client review are one continuous loop here, not three tools with exports in between."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="rounded-2xl border border-white/8 bg-white/[0.02] p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-sky-400">{g.title}</h2>
              <dl className="mt-4 space-y-4">
                {g.items.map(([term, desc]) => (
                  <div key={term}>
                    <dt className="text-sm font-medium text-white">{term}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-zinc-400">{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Section>

      <Section title="An honest note on screenshots">
        <div className="max-w-3xl rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm leading-relaxed text-zinc-300">
          <p>
            No website can stop an operating-system screenshot, a screen recorder or a phone camera. Any product claiming otherwise is
            overselling a blurred overlay.
          </p>
          <p className="mt-3">
            What a protected link does do: removes every download, export and print path; watermarks the view with the recipient name and
            the date; hides the design whenever the window loses focus, which is exactly what capture tools do; overwrites the clipboard
            after a PrintScreen; and records the attempt in your activity log. Casual copying becomes awkward, and anything that does get
            out points back to the link it came from.
          </p>
        </div>
      </Section>

      <div className="mx-auto max-w-6xl px-5 pb-8 text-center">
        <TrialButton />
      </div>
    </>
  );
}
