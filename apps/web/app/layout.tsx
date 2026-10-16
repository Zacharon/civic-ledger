import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Civic Ledger',
  description:
    'Public campaign money, votes, independent scores, promises and platforms for U.S. officeholders, with every number linked to its source.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
