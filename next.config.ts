import type { NextConfig } from 'next';
const config: NextConfig = {
 turbopack: { root: process.cwd() }, poweredByHeader: false,
 outputFileTracingExcludes: { '/api/**': ['.runtime/**/*', '.env*', 'artifacts/**/*'] },
};
export default config;
