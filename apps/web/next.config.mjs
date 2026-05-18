/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@goget/shared"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
};
export default nextConfig;
