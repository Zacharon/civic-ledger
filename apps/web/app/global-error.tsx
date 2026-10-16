'use client';

/** Last-resort boundary when the root layout itself fails; it must render its own document. */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'Georgia, serif',
          padding: '4rem 1.5rem',
          maxWidth: '40rem',
          margin: '0 auto',
        }}
      >
        <h1>Civic Ledger is unavailable</h1>
        <p>The site could not start this page. Try again in a moment.</p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </body>
    </html>
  );
}
