import { StandaloneApp } from '../src/standalone/StandaloneApp';
import { publicMetadata } from '../src/standalone/siteMetadata';
export const metadata = publicMetadata('/');
export default function Page() {
  return (
    <StandaloneApp
      initialPath="/"
      basePath={process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || ''}
      siteOrigin={process.env.CANVAS_SITE_URL}
    />
  );
}
