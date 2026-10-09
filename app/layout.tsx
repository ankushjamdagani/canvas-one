import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@xyflow/react/dist/style.css';
import '../src/styles.css';
import { PwaRegistration } from '../src/standalone/PwaRegistration';

const basePath = process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '';
const description = 'Beyond chat: The shared canvas for engineers and AI to think, architect, and review systems together.';
export const metadata: Metadata = {
  title: { default: 'Canvas One — The shared canvas for engineers and AI', template: '%s | Canvas One' },
  description,
  applicationName: 'Canvas One',
  manifest: `${basePath}/manifest.webmanifest`,
  icons: { icon: `${basePath}/favicon.svg`, apple: `${basePath}/pwa/icon-192.png` },
  openGraph: { title: 'Canvas One', description, type: 'website' },
};
export const viewport: Viewport = { themeColor: '#fafbf9', colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body style={{ margin: 0 }}>{children}<PwaRegistration basePath={basePath} /></body></html>;
}
