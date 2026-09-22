import { Link } from 'react-router-dom';
import { TrialButton } from '../App.jsx';
import { FAQS, SITE } from '../seo.js';
import { PlanPreview, Section, Stat } from '../components/Bits.jsx';

const FEATURES = [
  {
    title: 'Draw in 2D, check it in 3D',
    body: 'The plan and the model are the same data. Move a wall in the plan and it has already moved in the walkthrough — no export step, no waiting for a render.',
  },
  {
    title: 'Blender-style navigation',
    body: 'Middle-drag orbits, Shift+middle pans, the wheel zooms into whatever is under the cursor, and G / R / S move, rotate and scale with axis locks and typed values.',
  },
  {
    title: 'Ready-made 1, 2 and 3 BHK plans',
    body: 'Start from a finished home with walls, doors, windows, kitchen appliances and bathrooms already placed. Compare carpet areas room by room before you pick one.',
  },
  {
    title: '70+ pieces, measured properly',
    body: 'Sofas and beds through to washing machines, chimney hoods, split ACs, geysers and pooja units — every piece at a real-world size, so the plan tells the truth.',
  },
  {
    title: 'Client links that stay read-only',
    body: 'Send a link, not a file. No editing, no download, no print — with a watermark carrying the client’s name, an optional passcode and an expiry date.',
  },
  {
    title: 'Know when it was opened',
    body: 'Every client link records when it was opened and logs any attempt to capture or print, so you know where a design has been.',
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(60% 50% at 15% 0%, rgba(56,189,248,0.18), transparent 60%), radial-gradient(50% 45% at 85% 10%, rgba(79,70,229,0.20), transparent 60%)',
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-16 lg:grid-cols-2 lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              Free trial · no card, no install
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
              Design the space.
              <br />
              Send the client a link, not a file.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-400">
              {SITE.name} is a browser-based floor plan and 3D interior tool for architects and interior designers. Draw in 2D, walk through
              in 3D, furnish from a catalogue that knows real dimensions — then share a watermarked, view-only link that cannot be edited,
              downloaded or printed.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <TrialButton />
              <Link
                to="/plans"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/25 hover:text-white"
              >
                See the ready-made plans
              </Link>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4">
              <Stat value="8" label="starter plans" />
              <Stat value="70+" label="furniture pieces" />
              <Stat value="0" label="installs required" />
            </dl>
          </div>

          <div className="relative">
            <div className="rounded-2xl border border-white/10 bg-[#0c0f16] p-3 shadow-2xl shadow-black/50">
              <PlanPreview />
              <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-zinc-500">
                <span>3 BHK · 12.0 × 10.0 m · 120 m²</span>
                <span className="text-emerald-400">Protected client view</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <Section
        id="features"
        eyebrow="What you get"
        title="Everything between the first wall and the client sign-off"
        lead="The parts of the job that usually need three different tools — drafting, visualising and sharing — in one browser tab."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 transition hover:border-white/15">
              <h3 className="text-sm font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </article>
          ))}
        </div>
      </Section>

      {/* The recorded walkthrough */}
      <Section
        eyebrow="Watch it work"
        title="The whole workflow in under four minutes"
        lead="Recorded straight from the app: signing in, picking a plan, furnishing it, painting a wall, the 3D walkthrough, exporting, and sending a client a protected link."
      >
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl">
          <video
            controls
            preload="metadata"
            playsInline
            poster="/og-cover.svg"
            className="aspect-[16/10] w-full bg-black"
          >
            <source src="/user-manual.mp4" type="video/mp4" />
            Your browser cannot play this video.
          </video>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          13 chapters · create · navigate · add objects · move and rotate · paint a wall · 3D · viewpoints · exact
          transforms · export · share · the in-app guided tour.
        </p>
      </Section>

      {/* How it works */}
      <Section eyebrow="How it works" title="Three steps to a client-ready walkthrough">
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            ['Pick a plan or draw one', 'Open a 1, 2 or 3 BHK layout that already has walls, doors, windows and furniture — or start from an empty floor.'],
            ['Furnish and finish', 'Drop in furniture at real sizes, apply wood, stone, metal and fabric finishes, and check it under four lighting presets.'],
            ['Share it read-only', 'Generate a client link with a watermark, an expiry and an optional passcode. They open it in a browser; nothing can be edited or saved.'],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500/15 text-sm font-semibold text-sky-300">{i + 1}</span>
              <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* FAQ — also the source of the FAQPage structured data */}
      <Section eyebrow="Questions" title="Straight answers">
        <div className="mx-auto max-w-3xl divide-y divide-white/8 rounded-2xl border border-white/8 bg-white/[0.02]">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-medium text-zinc-100 marker:hidden">
                <span className="flex items-start justify-between gap-4">
                  {f.q}
                  <span className="mt-0.5 text-zinc-500 transition group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5">
        <div className="rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 to-indigo-600/10 px-6 py-12 text-center">
          <h2 className="text-2xl font-semibold text-white">Try it on your next project</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
            Open a 2 BHK template, move a wall, switch to 3D, and send yourself a client link — about five minutes, start to finish.
          </p>
          <div className="mt-6 flex justify-center">
            <TrialButton />
          </div>
        </div>
      </section>
    </>
  );
}
