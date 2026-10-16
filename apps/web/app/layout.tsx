import type { Metadata, Viewport } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { instrumentSans, newsreader } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Civic Ledger', template: '%s · Civic Ledger' },
  description:
    'Campaign money, roll-call votes, independent scores, promises and platforms for U.S. members of Congress, with every number linked to its source.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f3ee' },
    { media: '(prefers-color-scheme: dark)', color: '#141311' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${instrumentSans.variable}`}>
      <body className="flex min-h-dvh flex-col bg-paper font-sans text-ink antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <NuqsAdapter>
          <SiteHeader />
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
          <SiteFooter />
        </NuqsAdapter>
      </body>
    </html>
  );
}
