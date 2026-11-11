import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Receipt images for Lendo AI are sent to a server action.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
