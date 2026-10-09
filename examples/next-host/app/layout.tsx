import type { Metadata } from 'next';
import '@canvas-one/react/styles.css';
import './host.css';

export const metadata: Metadata = { title: 'Canvas One host example' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
