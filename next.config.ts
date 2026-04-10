import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    turbo: {
      root: './',
    },
  },
};

export default nextConfig;
