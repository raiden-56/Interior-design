import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Interior Studio to open your projects.',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090b10] px-4 py-10 text-zinc-200">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
