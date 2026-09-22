import { Section } from '../components/Bits.jsx';
import { TrialButton } from '../App.jsx';
import { SITE } from '../seo.js';

const TIERS = [
  {
    name: 'Free trial',
    price: '₹0',
    cadence: 'for 14 days',
    highlight: false,
    blurb: 'The whole product, nothing held back, while you decide.',
    features: ['All ready-made plans', 'Full 2D + 3D editor', '70+ furniture pieces', '3 client links', 'Projects saved in your browser'],
    cta: 'Start free trial',
  },
  {
    name: 'Studio',
    price: '₹1,499',
    cadence: 'per designer / month',
    highlight: true,
    blurb: 'For a working designer sending drawings to clients every week.',
    features: [
      'Unlimited projects and floors',
      'Unlimited client links with expiry and passcode',
      'Watermarking and activity log',
      'Cloud sync across devices',
      'Email support',
    ],
    cta: 'Start free trial',
  },
  {
    name: 'Practice',
    price: 'Talk to us',
    cadence: 'for teams of five or more',
    highlight: false,
    blurb: 'Shared project library, collaborator roles and onboarding for the team.',
    features: ['Everything in Studio', 'Collaborator (edit) roles', 'Shared template library', 'Priority support', 'Self-hosting option'],
    cta: 'Contact sales',
  },
];

export default function Pricing() {
  return (
    <Section eyebrow="Pricing" title="Start free. Pay when it earns its place." lead="No card to begin, and the trial is not a cut-down demo.">
      <div className="grid gap-4 lg:grid-cols-3">
        {TIERS.map((t) => (
          <article
            key={t.name}
            className={
              'flex flex-col rounded-2xl border p-6 ' + (t.highlight ? 'border-sky-500/40 bg-sky-500/[0.06]' : 'border-white/8 bg-white/[0.02]')
            }
          >
            {t.highlight && (
              <span className="mb-3 w-fit rounded-full bg-sky-500/20 px-2.5 py-1 text-[11px] font-semibold text-sky-300">Most popular</span>
            )}
            <h2 className="text-sm font-semibold text-white">{t.name}</h2>
            <p className="mt-3 flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold text-white">{t.price}</span>
              <span className="text-xs text-zinc-500">{t.cadence}</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{t.blurb}</p>
            <ul className="mt-5 flex-1 space-y-2 text-sm text-zinc-300">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {t.cta === 'Contact sales' ? (
                <a
                  href="/contact"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-sm font-medium text-zinc-200 hover:border-white/30"
                >
                  {t.cta}
                </a>
              ) : (
                <TrialButton className="w-full" children={t.cta} />
              )}
            </div>
          </article>
        ))}
      </div>
      <p className="mt-6 text-xs text-zinc-500">
        Prices are indicative for this preview build of {SITE.name}. Nothing is charged during the trial.
      </p>
    </Section>
  );
}
