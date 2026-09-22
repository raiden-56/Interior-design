import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center px-5 py-28 text-center">
      <p className="text-6xl font-semibold text-white">404</p>
      <h1 className="mt-4 text-lg font-medium text-zinc-200">That page has moved, or never existed</h1>
      <p className="mt-2 text-sm text-zinc-500">Try the plans gallery, or head back to the homepage.</p>
      <div className="mt-6 flex gap-3">
        <Link to="/" className="rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-400">
          Home
        </Link>
        <Link to="/plans" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-medium text-zinc-200 hover:border-white/30">
          Ready-made plans
        </Link>
      </div>
    </section>
  );
}
