import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <p className="num text-sm font-semibold text-ink-3">404</p>
      <h1 className="rule-total mt-2 inline-block pb-1 font-serif text-4xl font-medium tracking-tight">
        No entry in the ledger
      </h1>
      <p className="mt-5 max-w-prose text-lg text-ink-2">
        This page does not exist. If you followed a link to a member, they may not be in the loaded
        data, or the address may have a typo.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/explore" className="btn btn-primary">
          Search the table
        </Link>
        <Link href="/" className="btn btn-secondary">
          Go to the home page
        </Link>
      </div>
    </div>
  );
}
