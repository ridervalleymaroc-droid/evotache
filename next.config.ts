import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise l'accès en local via votre adresse IP
  allowedDevOrigins: ['192.168.1.22'],
  // Hostinger's proxy sits in front of the Node server and caches responses
  // more aggressively than Next.js's own defaults — including, sometimes,
  // the raw React Server Component payload meant for a client-side
  // navigation, later served back as if it were a full page (the "raw
  // $React.fragment JSON on screen" bug). Clearing Hostinger's cache by hand
  // fixes it every time, confirming it's a caching-layer issue, not a code
  // bug. Explicit no-store headers are the code-side fix: they tell any
  // downstream cache never to store these responses, so nothing is left to
  // serve back stale/wrong later. Scoped to everything except /_next/static
  // (content-hashed, safe — and meant — to cache forever).
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
