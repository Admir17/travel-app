import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pins the workspace root to this project directory. Without this,
    // Next.js can get confused if a lockfile happens to exist in a parent
    // directory (e.g. the user's home folder) and infer the wrong root.
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
