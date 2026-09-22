import { Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import { SITE, PAGES } from './seo.js';
import { Seo } from './components/Seo.jsx';
import Home from './pages/Home.jsx';
import Features from './pages/Features.jsx';
import Plans from './pages/Plans.jsx';
import Pricing from './pages/Pricing.jsx';
import Contact from './pages/Contact.jsx';
import NotFound from './pages/NotFound.jsx';

/** The one call to action that matters: into the app. */
export function TrialButton({ className = '', children = 'Start free trial' }) {
  return (
    <a
      href={`${SITE.appUrl}/login`}
      className={
        'inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 ' +
        className
      }
    >
      {children}
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 10h11M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

function Header() {
  const nav = PAGES.filter((p) => p.path !== '/');
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#070910]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2.5 font-semibold text-white">
          <img src="/logo.svg" alt="" width="28" height="28" className="rounded-lg" />
          {SITE.name}
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {nav.map((p) => (
            <NavLink
              key={p.path}
              to={p.path}
              className={({ isActive }) =>
                'rounded-lg px-3 py-2 text-sm transition ' + (isActive ? 'text-sky-300' : 'text-zinc-400 hover:text-zinc-100')
              }
            >
              {p.path.replace('/', '').replace(/^\w/, (c) => c.toUpperCase())}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href={`${SITE.appUrl}/login`} className="hidden rounded-lg px-3 py-2 text-sm text-zinc-300 hover:text-white sm:inline">
            Sign in
          </a>
          <TrialButton className="!px-4 !py-2" children="Free trial" />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-white/5 bg-[#05070c]">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5 font-semibold text-white">
            <img src="/logo.svg" alt="" width="24" height="24" className="rounded-md" />
            {SITE.name}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">{SITE.tagline}. Built for architects and interior designers.</p>
        </div>
        <nav aria-label="Product">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Product</h2>
          <ul className="mt-3 space-y-2 text-sm text-zinc-400">
            <li><Link to="/features" className="hover:text-zinc-100">Features</Link></li>
            <li><Link to="/plans" className="hover:text-zinc-100">Ready-made plans</Link></li>
            <li><Link to="/pricing" className="hover:text-zinc-100">Pricing</Link></li>
          </ul>
        </nav>
        <nav aria-label="Company">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Company</h2>
          <ul className="mt-3 space-y-2 text-sm text-zinc-400">
            <li><Link to="/contact" className="hover:text-zinc-100">Contact</Link></li>
            <li><a href={`${SITE.appUrl}/login`} className="hover:text-zinc-100">Sign in</a></li>
          </ul>
        </nav>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Get started</h2>
          <p className="mt-3 text-sm text-zinc-500">No install. Works in the browser.</p>
          <TrialButton className="mt-3 !px-4 !py-2" />
        </div>
      </div>
      <div className="border-t border-white/5 px-5 py-5 text-center text-xs text-zinc-600">
        © {new Date().getFullYear()} {SITE.name}. All rights reserved.
      </div>
    </footer>
  );
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <>
      <Seo pathname={pathname} />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-sky-500 focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/features" element={<Features />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
