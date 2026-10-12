import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@canvas-one/editor-reactflow/style.css';
import '../../../src/styles.css';
import { PwaRegistration } from '../../../src/standalone/PwaRegistration';
import { INITIAL_LOAD_BOOTSTRAP, INITIAL_LOAD_STYLE } from '../../../src/lib/motion/initial-load';

const basePath = process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '';
const description =
  'Stop prompting in a box: The open canvas to collaborate visually with AI.';
export const metadata: Metadata = {
  title: {
    default: 'Canvas One — Collaborate visually with AI',
    template: '%s | Canvas One',
  },
  description,
  applicationName: 'Canvas One',
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: `${basePath}/favicon.svg`,
    apple: `${basePath}/pwa/icon-192.png`,
  },
  openGraph: { title: 'Canvas One', description, type: 'website' },
};
export const viewport: Viewport = {
  themeColor: '#fafbf9',
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: INITIAL_LOAD_STYLE }} />
        <script dangerouslySetInnerHTML={{ __html: INITIAL_LOAD_BOOTSTRAP }} />
        <noscript><style>{'.canvas-one-root [data-initial-loader], [data-initial-loader] { display: none !important; }'}</style></noscript>
      </head>
      <body style={{ margin: 0 }}>
        {children}
        <PwaRegistration basePath={basePath} />
      </body>
    </html>
  );
}
