import type { Metadata } from 'next';
import { StandaloneApp } from '../../src/standalone/StandaloneApp';
import { publicMetadata } from '../../src/standalone/siteMetadata';
export const metadata: Metadata = { ...publicMetadata('/brand'), title: 'Brand', description: 'Canvas One brand guidelines, visual language and interface foundations.' };
export default function Page() {
  return <StandaloneApp initialPath="/brand" basePath={process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || ''} siteOrigin={process.env.CANVAS_SITE_URL} />;
}
