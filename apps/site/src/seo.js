/**
 * One source of truth for everything a crawler reads.
 *
 * The same objects drive three things: the tags React renders during
 * client-side navigation, the `<head>` the prerenderer bakes into each static
 * HTML file, and the sitemap. Keeping them together is what stops a page from
 * quietly shipping with the homepage's title.
 */

export const SITE = {
  name: 'Interior Studio',
  // Override at build time: VITE_SITE_URL=https://yourdomain.com npm run build:site
  url: (import.meta.env?.VITE_SITE_URL ?? 'https://interiorstudio.app').replace(/\/$/, ''),
  appUrl: (import.meta.env?.VITE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  tagline: 'Floor plans, 3D walkthroughs and client-safe sharing',
  description:
    'Draw a floor plan in 2D, walk through it in 3D, furnish it from a 70-piece catalogue, and send clients a watermarked, view-only link. Free trial, no install.',
  locale: 'en_IN',
  twitter: '@interiorstudio',
};

export const PAGES = [
  {
    path: '/',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    keywords:
      'interior design software, floor plan software, 2D to 3D floor plan, home design tool, 2BHK 3BHK floor plans, architect client sharing, online room planner',
    priority: 1.0,
  },
  {
    path: '/features',
    title: 'Features — 2D plans, live 3D, client links',
    description:
      'Blender-style navigation, a 70-piece furniture catalogue, materials and lighting, ready-made 1/2/3 BHK plans, and watermarked view-only links with expiry and passcodes.',
    keywords: 'floor plan editor, 3D room design, furniture catalogue, watermarked client link, read only design sharing',
    priority: 0.9,
  },
  {
    path: '/plans',
    title: 'Ready-made house plans — 1 BHK, 2 BHK, 3 BHK',
    description:
      'Start from a finished home: 1 BHK, 2 BHK classic and open-plan, and 3 BHK layouts with walls, doors, windows and furniture already placed. Compare carpet areas room by room, then edit.',
    keywords: '1 bhk floor plan, 2 bhk floor plan, 3 bhk house plan, indian apartment layout, carpet area calculator',
    priority: 0.9,
  },
  {
    path: '/pricing',
    title: 'Pricing — start free',
    description: 'Start designing free. Studio and Practice plans add client links, activity logs and unlimited projects.',
    keywords: 'interior design software pricing, free floor plan tool, architect software cost',
    priority: 0.8,
  },
  {
    path: '/contact',
    title: 'Contact & support',
    description: 'Questions about Interior Studio, demos for practices, or help getting a project started.',
    keywords: 'interior studio support, contact, demo',
    priority: 0.5,
  },
];

export const pageFor = (pathname) => PAGES.find((p) => p.path === pathname) ?? PAGES[0];

/** Structured data: what puts the rich result in a search listing. */
export function jsonLdFor(pathname) {
  const page = pageFor(pathname);
  const graph = [
    {
      '@type': 'SoftwareApplication',
      name: SITE.name,
      applicationCategory: 'DesignApplication',
      operatingSystem: 'Web browser',
      description: SITE.description,
      url: SITE.url,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR', description: 'Free trial' },
      aggregateRating: undefined,
    },
    {
      '@type': 'Organization',
      name: SITE.name,
      url: SITE.url,
      logo: `${SITE.url}/logo.svg`,
    },
    {
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url: SITE.url + (page.path === '/' ? '' : page.path),
    },
  ];

  if (pathname === '/') {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

export const FAQS = [
  {
    q: 'Can my client edit the design I send them?',
    a: 'No. A client link opens a read-only view: no editing tools, no export, no download and no printing. You choose whether it expires, whether it needs a passcode, and whose name is watermarked across it.',
  },
  {
    q: 'Can you stop clients taking screenshots?',
    a: 'No web application can block an operating-system screenshot or a phone camera, and anyone claiming otherwise is overselling. What Interior Studio does is remove every download and print path, watermark the view with the recipient’s name and the date, hide the design when the window loses focus, and log every capture attempt — so a leaked image is traceable to the link it came from.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. It runs in the browser on any modern laptop. Projects are saved locally and, when the sync service is running, to your account so a link opens on any device.',
  },
  {
    q: 'What plans does it come with?',
    a: 'Ready-made 1 BHK, 2 BHK (classic and open-plan), 3 BHK, studio and single-room layouts, each with walls, doors, windows and furniture already placed. You can compare carpet areas room by room before picking one.',
  },
  {
    q: 'Is the 3D view real-time?',
    a: 'Yes. The plan and the 3D model are the same data, so a wall you move in 2D has moved in 3D by the time you switch. Navigation follows Blender conventions — middle-drag to orbit, Shift+middle to pan, G/R/S to transform.',
  },
];
