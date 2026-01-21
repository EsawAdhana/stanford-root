/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static HTML export so we can host on GitHub Pages
  output: 'export',
  // GitHub Pages serves your site from /<repo-name> (unless using a custom domain).
  // This ensures assets + routing work when deployed.
  basePath: process.env.NODE_ENV === 'production' ? '/revised-navigator' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/revised-navigator/' : '',
  images: { unoptimized: true },
};

export default nextConfig;
