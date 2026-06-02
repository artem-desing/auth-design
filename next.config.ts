import type { NextConfig } from "next";
import path from "node:path";

const isProd = process.env.NODE_ENV === "production";
// Repo name = path component on GitHub Pages: artem-desing.github.io/<repoName>/
const repoName = "auth-design";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Static HTML export for GitHub Pages:
  output: "export",
  // GH Pages serves the site from /<repo>/ on a user/org subdomain — basePath
  // and assetPrefix tell Next to prefix all internal URLs and asset URLs.
  basePath: isProd ? `/${repoName}` : undefined,
  assetPrefix: isProd ? `/${repoName}/` : undefined,
  // GH Pages serves index.html from directory paths; trailing slashes ensure
  // every route has a directory + index.html.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
