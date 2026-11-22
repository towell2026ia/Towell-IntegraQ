import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    const headers = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/portal/cliente", headers: [...headers,
        { key: "Content-Security-Policy", value: "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; form-action 'none'; base-uri 'self'" }] },
      { source: "/api/portal/cliente/:path*", headers },
    ];
  },
};

export default nextConfig;
