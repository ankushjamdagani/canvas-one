import type { Metadata } from 'next';
import { StandaloneApp } from '../../../../src/standalone/StandaloneApp';
export const metadata: Metadata = {
  title: 'Projects',
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <StandaloneApp
      initialPath="/projects"
      basePath={process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || ''}
      siteOrigin={process.env.CANVAS_SITE_URL}
    />
  );
}
