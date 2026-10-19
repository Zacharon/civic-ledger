# Web request supervision and safe diagnostics

Local implementation evidence; independent H3 and combined-candidate verification pending.

## Reproduced before changing runtime code

`pnpm exec vitest run apps/web/test/web-hardening.test.ts --maxWorkers 1`
failed both original assertions on the baseline: an unfinished JSON stream reached
the test's 500 ms guard rather than an HTTP deadline, and a synthetic exception
containing a credential-shaped URL appeared verbatim in the final log sink.
The same two test identities pass after the body deadline and safe serializer.
A later third test reproduced a diagnostic sink throwing instead of returning
the intended 404; it also passes after the guarded emission. Original local
red output is retained outside the public checkout; no actual secret was used.

## Changed behavior

- JSON body reads have an absolute configurable 10 s deadline and a 256 KiB cap.
  A stalled/aborted body is cancelled and returns an uncached correlated HTTP 408;
  a hostile stream cannot hold the response by hanging in its cancellation hook.
- Page capability reads log the proxy's request ID, capability, outcome and duration.
  The default 20 s response deadline does not claim to cancel a database query;
  the existing 15 s statement timeout still bounds each in-flight statement.
- Error serialization allows only known categories and SQLSTATE/error codes.
  Exception messages, stacks, SQL, URLs, input and headers are not emitted.
  Diagnostic sink failures preserve the business response without unsafe fallback.
- The production `start` command uses a small native Node server around Next's
  existing handler. Headers default to 10 s, request body to 30 s, socket inactivity
  to 30 s, keep-alive to 5 s, and total response to 25 s. Invalid/zero budgets refuse
  startup. An expired response sends 503 before headers or closes an active stream.
  Graceful SIGINT/SIGTERM shutdown closes the server and the Next application.

This uses the supported [Next custom-server interface](https://nextjs.org/docs/app/guides/custom-server)
and [Node HTTP server budgets](https://nodejs.org/docs/latest-v24.x/api/http.html).
Custom and standalone server outputs are incompatible; this app uses ordinary
`next build`, not standalone output. Existing development remains `next dev`.

## Actual targeted verification

`pnpm exec vitest run apps/web/test/web-hardening.test.ts apps/web/test/server-boundary.test.ts apps/web/test/observed-read.test.ts apps/web/test/handler.test.ts --maxWorkers 2`
passed **4 files / 25 tests**. A real incomplete-header TCP connection receives
408 without invoking the application; a stalled handler returns correlated 503,
then the same server answers a healthy request. Sink canaries stay absent and
the stalled page-read test ends within its deadline. Web typecheck passed before
the rollback fixture was added; full final-candidate checks remain pending.

Operational logging target: retain ordinary logs seven days; extend selected
incident metadata to 30 days when needed for an investigation. Host access and
retention settings must be verified during provisioning. These local sink tests
do not prove hosted event delivery, reverse-proxy behavior or log retention.
