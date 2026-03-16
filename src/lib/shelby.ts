/**
 * Shelby client and signer utilities for server-side use only.
 *
 * Required env vars:
 *   SHELBY_API_KEY                          — Geomi API key for bandwidth (optional but recommended)
 *   NEXT_MODULE_PUBLISHER_ACCOUNT_ADDRESS   — App account address on Shelbynet (blob owner)
 *   NEXT_MODULE_PUBLISHER_ACCOUNT_PRIVATE_KEY — Ed25519 private key for signing Shelby txs
 *
 * Architecture note:
 *   Shelbynet (chain ID 110) and Aptos testnet (chain ID 2) are different chains.
 *   The user's wallet signs Aptos testnet transactions (marketplace).
 *   The app's publisher key signs Shelbynet transactions (blob registration).
 */
import { Network, Ed25519PrivateKey, Account } from "@aptos-labs/ts-sdk";
import {
  ShelbyNodeClient,
  type BlobCommitments,
  type ErasureCodingConfig,
} from "@shelby-protocol/sdk/node";

// Shelby testnet fullnode URL — Shelby runs its own Aptos-compatible chain.
const SHELBY_TESTNET_FULLNODE = "https://api.testnet.shelby.xyz/v1";

// ── Shelby client singleton ────────────────────────────────────────────────

let _shelbyClient: ShelbyNodeClient | null = null;

// Shelbynet requires an Origin header on every request (both Aptos node and RPC).
// Node.js server-side fetches don't include one automatically.
let _fetchPatched = false;
function patchFetchForShelby(origin: string) {
  if (_fetchPatched) return;
  _fetchPatched = true;
  const _originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes("shelby.xyz")) {
      const existing = new Headers(init?.headers ?? {});
      if (!existing.has("Origin")) existing.set("Origin", origin);
      init = { ...init, headers: existing };
    }
    return _originalFetch(input, init);
  };
}

export function getShelbyClient(): ShelbyNodeClient {
  if (!_shelbyClient) {
    const shelbyApiKey = process.env.SHELBY_API_KEY;
    // VERCEL_URL is set automatically by Vercel (no https:// prefix).
    // NEXT_PUBLIC_APP_URL takes priority so you can override it explicitly.
    const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? vercelUrl ?? "http://localhost:3000";

    patchFetchForShelby(origin);

    _shelbyClient = new ShelbyNodeClient({
      network: Network.TESTNET,
      ...(shelbyApiKey ? { apiKey: shelbyApiKey } : {}),
      aptos: {
        network: Network.TESTNET,
        fullnode: SHELBY_TESTNET_FULLNODE,
        clientConfig: {
          HEADERS: { Origin: origin },
        },
      },
    });
  }
  return _shelbyClient;
}

// ── Publisher signer ────────────────────────────────────────────────────────

/**
 * Returns an Ed25519 Account for the marketplace publisher, used to sign
 * Shelby blob registration transactions on Shelbynet.
 */
export function getMarketplaceSigner(): Account {
  const rawKey = process.env.NEXT_MODULE_PUBLISHER_ACCOUNT_PRIVATE_KEY;
  if (!rawKey) throw new Error("NEXT_MODULE_PUBLISHER_ACCOUNT_PRIVATE_KEY is not set");
  // Strip the "ed25519-priv-" AIP-80 prefix if present.
  const hexKey = rawKey.replace(/^ed25519-priv-/, "");
  const privateKey = new Ed25519PrivateKey(hexKey);
  return Account.fromPrivateKey({ privateKey });
}

// ── Blob path helpers ───────────────────────────────────────────────────────

/**
 * Builds the blob path (the part after the account prefix) stored under the
 * publisher account on Shelbynet. Uses the last 8 hex chars of the seller
 * address for namespacing so blobs from different sellers don't collide.
 *
 * Path budget: the Move contract enforces MAX_BLOB_NAME_LENGTH = 200.
 * shelbyBlobName = publisherAddr(66) + "/" + blobPath.
 * To stay under 200 we need blobPath ≤ 133 chars.
 *   "datasets/" (9) + addrSuffix (8) + "/" (1) + timestamp (13) + "-" (1) + safe (≤40)
 *   = 72 chars max → shelbyBlobName ≤ 139 chars. ✓
 *
 * Using the full seller address in the path pushed shelbyBlobName to 237 chars
 * (over the 200-char limit) for files with names longer than ~43 characters,
 * causing register_dataset to abort with E_STRING_TOO_LONG.
 */
export function buildBlobPath(sellerAddress: string, filename: string): string {
  const addrSuffix = sellerAddress.replace(/^0x/, "").slice(-8);
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `datasets/${addrSuffix}/${Date.now()}-${safe}`;
}

/** 5-year expiration timestamp in Shelby microseconds (absolute). */
export function defaultExpirationMicros(): number {
  return Date.now() * 1000 + 5 * 365 * 24 * 60 * 60 * 1_000_000;
}

// ── Download helpers ───────────────────────────────────────────────────────

/**
 * Parses the on-chain `shelby_blob_name` (full canonical key) into
 * { account, blobPath } for use with the Shelby SDK.
 *
 * On-chain format: "<accountAddress>/<blobPath>"
 */
export function parseBlobName(fullBlobName: string): {
  account: string;
  blobPath: string;
} {
  const idx = fullBlobName.indexOf("/");
  if (idx === -1) {
    throw new Error(`Invalid blob name (no "/" found): ${fullBlobName}`);
  }
  return {
    account: fullBlobName.slice(0, idx),
    blobPath: fullBlobName.slice(idx + 1),
  };
}

// ── Commitment helpers ─────────────────────────────────────────────────────

/**
 * Converts the hex `blob_merkle_root` string from the Shelby SDK to a
 * `number[]` suitable for passing to the Move `register_dataset` entry function.
 */
export function merkleRootToBytes(hexMerkleRoot: string): number[] {
  const hex = hexMerkleRoot.startsWith("0x")
    ? hexMerkleRoot.slice(2)
    : hexMerkleRoot;
  return Array.from(Buffer.from(hex, "hex"));
}

// Re-export types used by the upload route.
export type { BlobCommitments, ErasureCodingConfig };
