import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  const base = process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '';
  return {
    id: `${base}/`, name: 'Canvas One', short_name: 'Canvas One',
    description: 'The shared canvas for engineers and AI.',
    start_url: `${base}/projects`, scope: `${base}/`, display: 'standalone',
    background_color: '#fafbf9', theme_color: '#fafbf9',
    icons: [192, 512].map(size => ({ src: `${base}/pwa/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
  };
}
