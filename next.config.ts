import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake barrel-heavy icon/UI packages so dev + prod bundles only
    // pull the components actually imported, not the whole barrel.
    optimizePackageImports: ["lucide-react", "radix-ui"],
  },
};

export default nextConfig;
