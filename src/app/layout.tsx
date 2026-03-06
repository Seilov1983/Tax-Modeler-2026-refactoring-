import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tax Structure Modeler 2026',
  description: 'Multi-jurisdictional tax structure modeling with real-time risk detection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
