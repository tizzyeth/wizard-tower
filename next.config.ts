import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in the home directory breaks workspace-root inference.
  turbopack: {
    root: __dirname,
  },
  images: {
    // The Prophecy Feed (M6) renders X avatars + media thumbnails from Twitter's
    // CDN via next/image, which requires the host be allow-listed. Both profile
    // images (/profile_images/**) and post media (/media/**, /*_video_thumb/**)
    // are served from pbs.twimg.com; `pathname: "/**"` covers them all. Query
    // strings on some media URLs (?format=jpg&name=…) are allowed by omitting
    // `search` (implied wildcard) — acceptable since we only ever pass URLs our
    // own poller recorded from the X API, never arbitrary user input.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pbs.twimg.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
