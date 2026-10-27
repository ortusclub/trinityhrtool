import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The payroll app's files are read from disk by its route handler, so
  // they have to ship with that function.
  outputFileTracingIncludes: {
    "/payroll-app/[...path]": ["./src/payroll-app/**/*"],
  },
};

export default nextConfig;
