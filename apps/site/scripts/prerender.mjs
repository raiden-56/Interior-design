import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Static prerendering.
 *
 * A single-page React app serves an empty <div> to anything that does not run
 * JavaScript, which is a bad starting position for search. This renders every
 * route to real HTML at build time — full markup, a correct <head> and its
 * structured data baked in — and the client hydrates that same markup. No
 * framework migration, no runtime server.
 *
 * Run by `npm run build:site` after the client and SSR bundles are built.
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// Windows absolute paths have to reach the ESM loader as file:// URLs.
const { render } = await import(pathToFileURL(path.join(`${dist}-ssr`, 'entry-server.js')).href);
const { PAGES, SITE, jsonLdFor } = await import(pathToFileURL(path.join(root, 'src', 'seo.js')).href);

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function headFor(page) {
  const url = SITE.url + (page.path === '/' ? '/' : page.path);
  const image = `${SITE.url}/og-cover.svg`;
  // Tagged so the client can drop them and let React own the head after
  // hydration; a crawler that never runs JavaScript keeps them.
  return [
    `<title data-seo="static">${escape(page.title)}</title>`,
    `<meta data-seo="static" name="description" content="${escape(page.description)}" />`,
    `<meta data-seo="static" name="keywords" content="${escape(page.keywords)}" />`,
    `<link data-seo="static" rel="canonical" href="${escape(url)}" />`,
    `<meta data-seo="static" name="robots" content="index,follow,max-image-preview:large" />`,
    `<meta data-seo="static" property="og:type" content="website" />`,
    `<meta data-seo="static" property="og:site_name" content="${escape(SITE.name)}" />`,
    `<meta data-seo="static" property="og:title" content="${escape(page.title)}" />`,
    `<meta data-seo="static" property="og:description" content="${escape(page.description)}" />`,
    `<meta data-seo="static" property="og:url" content="${escape(url)}" />`,
    `<meta data-seo="static" property="og:image" content="${escape(image)}" />`,
    `<meta data-seo="static" property="og:locale" content="${escape(SITE.locale)}" />`,
    `<meta data-seo="static" name="twitter:card" content="summary_large_image" />`,
    `<meta data-seo="static" name="twitter:title" content="${escape(page.title)}" />`,
    `<meta data-seo="static" name="twitter:description" content="${escape(page.description)}" />`,
    `<meta data-seo="static" name="twitter:image" content="${escape(image)}" />`,
    `<script data-seo="static" type="application/ld+json">${JSON.stringify(jsonLdFor(page.path))}</script>`,
  ].join('\n    ');
}

let written = 0;
for (const page of PAGES) {
  const appHtml = render(page.path);
  const html = template.replace('<!--app-head-->', headFor(page)).replace('<!--app-html-->', appHtml);
  const outDir = page.path === '/' ? dist : path.join(dist, page.path.slice(1));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  written += 1;
  console.log('  prerendered', page.path);
}

// 404 page, for hosts that serve it by convention.
const notFound = template
  .replace('<!--app-head-->', `<title>Page not found · ${escape(SITE.name)}</title>\n    <meta name="robots" content="noindex" />`)
  .replace('<!--app-html-->', render('/__not-found'));
fs.writeFileSync(path.join(dist, '404.html'), notFound);

// Sitemap + robots, generated from the same page list.
const today = new Date().toISOString().slice(0, 10);
const urls = PAGES.map((p) => {
  const loc = `${SITE.url}${p.path === '/' ? '/' : p.path}`;
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    `    <priority>${p.priority.toFixed(1)}</priority>`,
    '  </url>',
  ].join('\n');
}).join('\n');

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  urls,
  '</urlset>',
  '',
].join('\n');
fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap);

fs.writeFileSync(
  path.join(dist, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /view/\n\nSitemap: ${SITE.url}/sitemap.xml\n`,
);

// A simple social card so shared links are not blank.
fs.writeFileSync(
  path.join(dist, 'og-cover.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#111827"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1040" cy="90" r="220" fill="#38bdf8" opacity="0.12"/>
  <circle cx="160" cy="560" r="200" fill="#4f46e5" opacity="0.12"/>
  <text x="80" y="290" font-family="system-ui, sans-serif" font-size="66" font-weight="700" fill="#ffffff">${escape(SITE.name)}</text>
  <text x="80" y="360" font-family="system-ui, sans-serif" font-size="34" fill="#94a3b8">${escape(SITE.tagline)}</text>
  <text x="80" y="430" font-family="system-ui, sans-serif" font-size="26" fill="#38bdf8">Free trial · no install · client-safe sharing</text>
</svg>
`,
);

console.log(`\n  ${written} routes prerendered, sitemap.xml + robots.txt written to dist/\n`);
