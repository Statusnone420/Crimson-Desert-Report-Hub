import type { NextConfig } from "next";

// Turnstile needs script + frame access to challenges.cloudflare.com on the
// report page. 'unsafe-inline' scripts are required by Next.js hydration;
// 'unsafe-eval' is only needed by the dev overlay/HMR.
const impeccableLiveDev =
  process.env.NODE_ENV === "development" ? " http://localhost:8400" : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}${impeccableLiveDev} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${impeccableLiveDev} https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // The Method page is cited as "the method" across the site; /method is
      // the address readers guess. Keep /about canonical.
      {
        source: "/method",
        destination: "/about",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "crimson-desert-report-hub\\.vercel\\.app",
          },
        ],
        destination: "https://crimsonreporthub.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "www\\.crimsonreporthub\\.com",
          },
        ],
        destination: "https://crimsonreporthub.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
