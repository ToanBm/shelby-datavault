/**
 * In-memory nonce store for download authentication.
 * Nonces are single-use and expire after NONCE_TTL_MS.
 *
 * Note: this works for single-process deployments (local dev, single-instance production).
 * For multi-instance deployments, replace with Redis or a similar shared store.
 */

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// nonce → expiresAt (Unix ms)
const store = new Map<string, number>();

/** Creates a new nonce, stores it, and returns it. */
export function createNonce(): string {
  // Purge expired entries opportunistically on every write
  const now = Date.now();
  for (const [nonce, expiresAt] of store) {
    if (expiresAt < now) store.delete(nonce);
  }
  const nonce = crypto.randomUUID();
  store.set(nonce, now + NONCE_TTL_MS);
  return nonce;
}

/**
 * Validates and consumes a nonce.
 * Returns true if the nonce was valid and has been removed from the store.
 * Returns false if the nonce was missing or expired (replay-safe).
 */
export function consumeNonce(nonce: string): boolean {
  const expiresAt = store.get(nonce);
  store.delete(nonce); // always delete — prevents replay even on race
  if (!expiresAt || Date.now() > expiresAt) return false;
  return true;
}
