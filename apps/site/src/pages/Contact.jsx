import { Section } from '../components/Bits.jsx';
import { SITE } from '../seo.js';

export default function Contact() {
  return (
    <Section eyebrow="Contact" title="Talk to us" lead="Questions about a project, a demo for your practice, or help getting started.">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6">
          <h2 className="text-sm font-semibold text-white">Email</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            <a href="mailto:hello@interiorstudio.app" className="text-sky-400 hover:text-sky-300">
              hello@interiorstudio.app
            </a>
            <br />
            We answer within one working day.
          </p>

          <h2 className="mt-6 text-sm font-semibold text-white">Already have an account?</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            <a href={`${SITE.appUrl}/login`} className="text-sky-400 hover:text-sky-300">
              Sign in to the studio
            </a>{' '}
            and pick up where you left off.
          </p>

          <h2 className="mt-6 text-sm font-semibold text-white">For clients</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            If a designer sent you a link to a design, open that link directly — you do not need an account, and the view is read-only.
          </p>
        </div>

        <form
          className="rounded-2xl border border-white/8 bg-white/[0.02] p-6"
          onSubmit={(e) => {
            // There is no form backend in this build. Rather than pretending a
            // message was sent, hand the same details to the mail client.
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const body = `Name: ${data.get('name')}\nEmail: ${data.get('email')}\n\n${data.get('message')}`;
            window.location.href = `mailto:hello@interiorstudio.app?subject=${encodeURIComponent('Interior Studio enquiry')}&body=${encodeURIComponent(body)}`;
          }}
        >
          <label className="block text-xs font-medium text-zinc-400">
            Name
            <input
              name="name"
              required
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <label className="mt-3 block text-xs font-medium text-zinc-400">
            Email
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <label className="mt-3 block text-xs font-medium text-zinc-400">
            Message
            <textarea
              name="message"
              rows={4}
              required
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <button type="submit" className="mt-4 w-full rounded-xl bg-sky-500 py-2.5 text-sm font-semibold text-white hover:bg-sky-400">
            Send
          </button>
          <p className="mt-2 text-[11px] text-zinc-500">Opens your mail app — nothing is stored on this site.</p>
        </form>
      </div>
    </Section>
  );
}
