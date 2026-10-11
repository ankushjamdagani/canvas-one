import type { MetadataRoute } from 'next';
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.CANVAS_SITE_URL;
  if (!origin) return [];
  const base = process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '';
  return ['/', '/brand'].map(path => ({ url: `${new URL(origin).origin}${base}${path}` }));
}
