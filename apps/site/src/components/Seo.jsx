import { useEffect, useState } from 'react';
import { SITE, pageFor, jsonLdFor } from '../seo.js';

/**
 * Per-route metadata.
 *
 * React 19 hoists <title>, <meta> and <link> rendered anywhere in the tree
 * into the document head, so this needs no helmet library — which matters
 * because react-helmet-async still caps out at React 18. Crawlers get their
 * tags from the prerendered HTML (see scripts/prerender.mjs); this keeps the
 * head correct as visitors navigate between routes.
 */
export function Seo({ pathname }) {
  // Nothing is rendered during prerendering or on the hydration pass: the
  // static head is already correct, and emitting the same tags into the body
  // would duplicate the structured data.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const page = pageFor(pathname);
  const url = SITE.url + (page.path === '/' ? '/' : page.path);
  const image = `${SITE.url}/og-cover.svg`;

  if (!mounted) return null;

  return (
    <>
      <title>{page.title}</title>
      <meta name="description" content={page.description} />
      <meta name="keywords" content={page.keywords} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE.name} />
      <meta property="og:title" content={page.title} />
      <meta property="og:description" content={page.description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:locale" content={SITE.locale} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={page.title} />
      <meta name="twitter:description" content={page.description} />
      <meta name="twitter:image" content={image} />
      <meta name="robots" content="index,follow,max-image-preview:large" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor(pathname)) }} />
    </>
  );
}
