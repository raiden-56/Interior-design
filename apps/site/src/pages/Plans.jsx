import { Section, PlanPreview } from '../components/Bits.jsx';
import { TrialButton } from '../App.jsx';

/** Figures come from the plans the app actually builds — see apps/web/src/lib/templates.ts. */
const PLANS = [
  { name: '1 BHK apartment', size: '8.0 × 7.0 m', area: '56 m² · 603 sq ft', items: '33 pieces', rooms: 'Bedroom · bathroom with laundry · galley kitchen · living-dining across the front' },
  { name: '2 BHK family apartment', size: '10.0 × 9.0 m', area: '90 m² · 969 sq ft', items: '41 pieces', rooms: 'Two bedrooms · study · bathroom · kitchen · utility balcony, off a central passage' },
  { name: '2 BHK open-plan', size: '11.0 × 8.0 m', area: '88 m² · 947 sq ft', items: '48 pieces', rooms: 'Master suite with attached bath and walk-in wardrobe · second bedroom · island kitchen open to the living room' },
  { name: '3 BHK apartment', size: '12.0 × 10.0 m', area: '120 m² · 1292 sq ft', items: '61 pieces', rooms: 'Three bedrooms · two bathrooms · passage · full kitchen · utility and balcony' },
  { name: 'Studio apartment', size: '6.0 × 8.0 m', area: '48 m² · 517 sq ft', items: '18 pieces', rooms: 'One open room with sleeping, dining and kitchen zones' },
  { name: 'One-bedroom flat', size: '9.0 × 7.0 m', area: '63 m² · 678 sq ft', items: '24 pieces', rooms: 'Living-dining · bedroom · bathroom off a short hall' },
];

export default function Plans() {
  return (
    <>
      <Section
        eyebrow="Ready-made plans"
        title="Start from a finished home, not an empty grid"
        lead="Every layout ships with walls, doors, windows and furniture already placed, and every number below is measured from the plan you will actually open."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((p) => (
            <article key={p.name} className="flex flex-col rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <PlanPreview className="mb-4" />
              <h2 className="text-sm font-semibold text-white">{p.name}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {p.size} · {p.area}
              </p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{p.rooms}</p>
              <p className="mt-3 text-xs text-sky-400">{p.items} furnished</p>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Compare before you commit">
        <div className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          <p>
            Inside the app, the plan gallery shows each layout&apos;s footprint, carpet area in both m² and square feet, a room-by-room
            breakdown, how many pieces of furniture come with it, and what the layout is good at — so choosing between a compact 2 BHK and
            an open-plan one is a decision made on numbers rather than on a thumbnail.
          </p>
          <p className="mt-3">Whichever you open stays fully editable: move a wall, swap the kitchen layout, change the flooring.</p>
        </div>
        <div className="mt-6">
          <TrialButton children="Open the plan gallery" />
        </div>
      </Section>
    </>
  );
}
