import type { Metadata } from 'next';
import { ViewerRoute } from './ViewerRoute';

export const dynamic = 'force-dynamic';

/** A client link must never end up in a search index. */
export const metadata: Metadata = {
  title: 'Shared design',
  robots: { index: false, follow: false, nocache: true },
};

export default async function ViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ViewerRoute token={token} />;
}
