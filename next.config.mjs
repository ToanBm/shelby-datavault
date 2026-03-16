import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  disable: false,
});

// Your Next config is automatically typed!
export default withPWA({
  // Removed "output: export" — project uses server-side API routes for Shelby integration.
  distDir: "./dist",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,

  webpack(config) {
    // Required for @shelby-protocol/clay-codes which loads clay.wasm via
    // `new URL("./clay.wasm", import.meta.url)`. Without asyncWebAssembly,
    // webpack never registers __webpack_require__.U (the WASM chunk loader),
    // causing a "is not a constructor" runtime error in the browser.
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    return config;
  },
});
