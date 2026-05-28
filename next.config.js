/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a minimal, self-contained server bundle for the Docker image.
  // src/instrumentation.ts register() runs once at server startup (schema init);
  // instrumentation is enabled by default in Next 15.
  output: "standalone",
};

module.exports = nextConfig;
