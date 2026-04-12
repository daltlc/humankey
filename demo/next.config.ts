import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['humankey'],
  serverExternalPackages: ['@simplewebauthn/server'],
};

export default nextConfig;
