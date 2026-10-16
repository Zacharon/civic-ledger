import localFont from 'next/font/local';

// Self-hosted from npm packages: no CDN and no runtime font requests (DESIGN.md).
export const newsreader = localFont({
  src: [
    {
      path: '../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-italic.woff2',
      style: 'italic',
    },
  ],
  weight: '200 800',
  display: 'swap',
  variable: '--font-newsreader',
  fallback: ['Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const instrumentSans = localFont({
  src: '../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-instrument',
  fallback: ['Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
});
