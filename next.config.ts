import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // sharp and @napi-rs/canvas are native modules: keep them external to the
  // server bundle so Next does not try to trace/bundle their .node binaries.
  serverExternalPackages: ["sharp", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@napi-rs/canvas/**"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
    ],
  },
};

export default nextConfig;
