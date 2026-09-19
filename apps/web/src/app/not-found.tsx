import Link from 'next/link';
import { Layers } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#090b10] px-6 text-center text-zinc-300">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
        <Layers className="h-6 w-6" />
      </span>
      <h1 className="text-lg font-semibold text-zinc-100">Page not found</h1>
      <p className="max-w-sm text-sm text-zinc-500">That link doesn&apos;t point at anything in Interior Studio.</p>
      <Link href="/" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500">
        Back to your projects
      </Link>
    </main>
  );
}
