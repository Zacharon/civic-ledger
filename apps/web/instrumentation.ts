/**
 * Runs once when the server starts. A production server without a read-only database role
 * (VC-068) refuses to start, instead of failing, or connecting as the owner, on its first
 * request. The check imports Node-only code, so it loads only in the Node.js runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { refuseUnsafeDbConfig } = await import('./src/server/startup-check');
    refuseUnsafeDbConfig();
  }
}
