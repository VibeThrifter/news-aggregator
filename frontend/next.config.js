/** @type {import('next').NextConfig} */
const nextConfig = {
  // E2E runs and build checks use their own folder (NEXT_DIST_DIR=.next-test), so they never
  // overwrite the files of a running `npm run dev`
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
};

module.exports = nextConfig;
