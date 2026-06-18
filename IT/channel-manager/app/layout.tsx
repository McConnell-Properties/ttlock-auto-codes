import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'McConnell Enterprises — Channel Manager',
  description: 'Bookings, rates and availability across all channels',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="sidebar">
            <div className="brand">McConnell CM</div>
            <Link href="/">Dashboard</Link>
            <Link href="/multical">Multi calendar</Link>
            <Link href="/extras-cal">Extras cal</Link>
            <Link href="/extras-capacity">Extras capacity</Link>
            <Link href="/crm">CRM</Link>
            <Link href="/bookings">Bookings</Link>
            <Link href="/internal/dashboard">Inbox</Link>
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
