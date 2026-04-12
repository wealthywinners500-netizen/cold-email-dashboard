import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use standalone output to disable static site generation
  // This prevents Clerk validation errors during builds with test keys
  output: 'standalone',
  // Hard Lesson #72: ssh2 native .node binaries break webpack; externalize them
  serverExternalPackages: ['ssh2', 'node-ssh', 'cpu-features'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
