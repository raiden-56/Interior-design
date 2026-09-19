/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@interior/core'],
  // The editor is a large client-only bundle; disable pre-rendering of pages
  // that embed it. App Router/client components handle the rest.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;