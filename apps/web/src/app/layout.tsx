import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Interior Studio', template: '%s · Interior Studio' },
  description: 'Design rooms in 2D, walk through them in 3D, and let the AI assistant furnish them — all in your browser.',
  applicationName: 'Interior Studio',
};

export const viewport: Viewport = {
  themeColor: '#090b10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}