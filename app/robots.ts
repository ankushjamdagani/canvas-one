import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '';
  const origin = process.env.CANVAS_SITE_URL;
  return { rules: { userAgent: '*', allow: `${base}/`, disallow: [`${base}/projects`, `${base}/project/`] },
    ...(origin ? { sitemap: `${new URL(origin).origin}${base}/sitemap.xml` } : {}) };
}
