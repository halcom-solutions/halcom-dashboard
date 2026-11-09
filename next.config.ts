import type { NextConfig } from "next";

// Docker Desktop does not forward file-change events from Windows drives into
// Linux containers, so the dev container sets this to poll for changes instead.
const devPollIntervalMs = Number(process.env.NEXT_DEV_POLL_INTERVAL_MS) || undefined;

// The development server only serves its scripts and hot-reload channel to the origin it was opened on. 127.0.0.1 is
// allowed because the app is published there; without it a page opened as http://127.0.0.1:3000 shows but never becomes
// interactive (menus and buttons do nothing). Other names, such as the LAN address of this PC when testing on a phone,
// go in ALLOWED_DEV_ORIGINS (comma separated).
const allowedDevOrigins = [
  "127.0.0.1",
  ...(process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

// Server Actions (sign-in, every form) compare the Origin header with the forwarded host. Behind a tunnel or reverse proxy
// that rewrites the Origin (a VS Code dev tunnel, ngrok), they differ and the action is refused with a 500. The same
// ALLOWED_DEV_ORIGINS names (wildcards such as *.devtunnels.ms work) are accepted there as well.
// Next.js matches this list against the Origin header, which a tunnel that rewrites it leaves as the local address, so the
// local addresses are listed too (the app is published on the host's loopback only; the port is APP_HOST_PORT).
const hostPort = process.env.APP_HOST_PORT || "3000";
const serverActionOrigins = [
  `localhost:${hostPort}`,
  `127.0.0.1:${hostPort}`,
  ...allowedDevOrigins.filter((origin) => origin !== "127.0.0.1"),
];

const nextConfig: NextConfig = {
  allowedDevOrigins,
  // Self-contained server bundle used by the production Docker image.
  output: "standalone",
  // The PDF renderer (quotations, D-088) loads its layout engine and fonts at run time: it stays a plain Node package, traced into the
  // standalone output, instead of being bundled.
  serverExternalPackages: ["@react-pdf/renderer"],
  // AGENTS.md is this project's engineering charter; keep `next dev` from
  // inserting its managed agent-rules block into it.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  watchOptions: devPollIntervalMs ? { pollIntervalMs: devPollIntervalMs } : undefined,
  // Turbopack's on-disk dev cache goes stale between runs (after a restart or a Prisma client regeneration) and then every
  // page load is followed by "Compiled in 2ms" and a full reload, endlessly. Compiling from scratch costs a few seconds at
  // start-up, so the cache is off for the dev servers (`app` and the disposable `app-test`).
  // A project import posts the .xlsx file itself to a server action (5 MB at most, checked again on the server).
  experimental: { turbopackFileSystemCacheForDev: false, serverActions: { bodySizeLimit: "6mb", allowedOrigins: serverActionOrigins } },
  // Pages show one person's data. no-store keeps the browser's back/forward cache and any shared cache from showing the
  // last person's page to the next one on the same machine after a sign-out or an account switch.
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|icon\\.png|favicon\\.ico).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
