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

export const schibsted = localFont({
  src: '../node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2',
  weight: '400 900',
  display: 'swap',
  variable: '--font-schibsted',
  fallback: ['Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
});
