import { fileURLToPath } from 'node:url';
const basePath = (process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '').replace(/\/$/, '');
if (basePath && !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath)) {
  throw new Error('NEXT_PUBLIC_CANVAS_BASE_PATH must be an absolute URL path prefix.');
}
/** @type {import('next').NextConfig} */
export default {
  basePath,
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  poweredByHeader: false,
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
  },
};
