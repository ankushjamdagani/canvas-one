import type { Metadata } from 'next';
/** No public origin is guessed for local/self-hosted deployments. */
export function publicMetadata(path: '/' | '/brand'): Metadata {
  const site = process.env.CANVAS_SITE_URL;
  if (!site) return {};
  const base = process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '';
  return { alternates: { canonical: `${new URL(site).origin}${base}${path}` } };
}
