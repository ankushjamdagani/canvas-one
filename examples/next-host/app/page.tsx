import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="host-home" data-testid="host-home">
      <h1>Existing Next.js application</h1>
      <p>The magenta background and red primary token belong to this host.</p>
      <Link href="/canvas">Open Canvas One</Link>
    </main>
  );
}
