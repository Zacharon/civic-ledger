'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page-frame py-20 [&>*]:max-w-3xl">
      <h1 className="page-title">The ledger could not be read</h1>
      <p className="mt-5 max-w-prose text-lg text-ink-2">
        The data behind this page did not load. Nothing you did caused this. Try again; if it keeps
        happening, the database may be offline or still loading.
      </p>
      {error.digest ? (
        <p className="mt-3 text-sm text-ink-3">
          Reference: <span className="num">{error.digest}</span>
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          Try again
        </button>
        <Link href="/sources" className="btn btn-secondary">
          Check data status
        </Link>
      </div>
    </div>
  );
}
