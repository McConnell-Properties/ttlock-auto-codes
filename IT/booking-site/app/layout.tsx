import type { Metadata } from 'next';
import { currentProperty } from '@/lib/properties';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const prop = currentProperty();
  return {
    title: `${prop.displayName} — Book Direct & Save`,
    description: prop.description,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const prop = currentProperty();
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">{prop.displayName}</a>
          <span className="tagline">{prop.tagline}</span>
          <nav className="header-nav">
            <a href="/">Book a room</a>
            <a href="/portal">Guest portal</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <p>{prop.displayName} · Check-in from 3pm, check-out by 11am</p>
          <p>Questions? Email us — we reply fast. Free cancellation up to 48h before arrival.</p>
        </footer>
      </body>
    </html>
  );
}
