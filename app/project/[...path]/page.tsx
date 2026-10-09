import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StandaloneApp } from '../../../src/standalone/StandaloneApp';
export const metadata: Metadata = { title: 'Workspace', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.length !== 1 && !(path.length === 3 && path[1] === 'branch')) notFound();
  return <StandaloneApp initialPath={`/project/${path.map(encodeURIComponent).join('/')}`} basePath={process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || ''} siteOrigin={process.env.CANVAS_SITE_URL} />;
}
