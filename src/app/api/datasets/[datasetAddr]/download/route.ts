/**
 * GET /api/datasets/[datasetAddr]/download
 *
 * Streams a dataset file from Shelby to the buyer after verifying:
 *   1. A valid wallet signature over a server-issued nonce (proves the requester
 *      controls the private key for the claimed buyer address).
 *   2. On-chain access: marketplace::has_access(buyer, dataset) === true.
 *
 * Required headers:
 *   x-buyer-address  — The buyer's Aptos address
 *   x-nonce          — The nonce obtained from GET /api/auth/nonce
 *   x-signature      — Ed25519 hex signature from wallet signMessage()
 *   x-public-key     — Buyer's Ed25519 public key (hex)
 *
 * The signed message is reconstructed server-side as:
 *   "APTOS\nmessage: DataVault download auth\nnonce: <nonce>"
 * which matches the fullMessage produced by the Aptos wallet signMessage standard.
 */

import { NextRequest, NextResponse } from "next/server";
import { Ed25519PublicKey, Ed25519Signature, AccountAddress } from "@aptos-labs/ts-sdk";
import { consumeNonce } from "@/lib/nonceStore";
import { getShelbyClient, parseBlobName } from "@/lib/shelby";
import { checkOnChainAccess, getOnChainBlobName, getAptosServerClient } from "@/lib/aptosServer";

const MODULE_ADDRESS = process.env.NEXT_PUBLIC_MODULE_ADDRESS ?? "";

// The fixed message text used in signMessage — must match the frontend exactly.
const SIGN_MESSAGE_TEXT = "DataVault download auth";

function buildFullMessage(nonce: string): string {
  return `APTOS\nmessage: ${SIGN_MESSAGE_TEXT}\nnonce: ${nonce}`;
}

/**
 * Verifies the wallet signature and public key→address binding.
 * Returns an error string on failure, or null on success.
 */
function verifyDownloadAuth(
  buyerAddress: string,
  nonce: string,
  publicKeyHex: string,
  signatureHex: string
): string | null {
  // 1. Consume nonce — validates it exists, not expired, and prevents replay
  if (!consumeNonce(nonce)) {
    return "Invalid or expired nonce. Request a new one and try again.";
  }

  // 2. Verify Ed25519 signature over the reconstructed fullMessage
  let pubKey: Ed25519PublicKey;
  let sig: Ed25519Signature;
  try {
    pubKey = new Ed25519PublicKey(publicKeyHex);
    sig = new Ed25519Signature(signatureHex);
  } catch {
    return "Invalid public key or signature format.";
  }

  const fullMessage = buildFullMessage(nonce);
  const msgBytes = new TextEncoder().encode(fullMessage);
  const valid = pubKey.verifySignature({ message: msgBytes, signature: sig });
  if (!valid) return "Signature verification failed.";

  // 3. Verify the public key corresponds to the claimed buyer address
  try {
    const derived = pubKey.authKey().derivedAddress();
    const claimed = AccountAddress.fromString(buyerAddress);
    if (derived.toString() !== claimed.toString()) {
      return "Public key does not match buyer address.";
    }
  } catch {
    return "Invalid buyer address format.";
  }

  return null; // success
}

export async function GET(
  req: NextRequest,
  { params }: { params: { datasetAddr: string } }
) {
  const { datasetAddr } = params;

  const buyerAddress = req.headers.get("x-buyer-address");
  const nonce        = req.headers.get("x-nonce");
  const signature    = req.headers.get("x-signature");
  const publicKey    = req.headers.get("x-public-key");

  // ── 1. Validate required headers ────────────────────────────────────────
  if (!buyerAddress || !nonce || !signature || !publicKey) {
    return NextResponse.json(
      { error: "Missing required headers: x-buyer-address, x-nonce, x-signature, x-public-key" },
      { status: 400 }
    );
  }

  // ── 2. Verify wallet signature ───────────────────────────────────────────
  const authError = verifyDownloadAuth(buyerAddress, nonce, publicKey, signature);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  // ── 3. Verify on-chain access (buyer or owner) ──────────────────────────
  let canAccess = await checkOnChainAccess(buyerAddress, datasetAddr);

  // Sellers can always download their own datasets
  if (!canAccess) {
    try {
      const aptos = getAptosServerClient();
      const [, owner] = await aptos.view({
        payload: {
          function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_info`,
          typeArguments: [],
          functionArguments: [datasetAddr],
        },
      });
      const ownerNorm = AccountAddress.fromString(owner as string).toString();
      const buyerNorm = AccountAddress.fromString(buyerAddress).toString();
      if (ownerNorm === buyerNorm) canAccess = true;
    } catch {
      // ignore — will fall through to 403
    }
  }

  if (!canAccess) {
    return NextResponse.json(
      { error: "Access denied. Purchase this dataset first." },
      { status: 403 }
    );
  }

  // ── 4. Resolve the Shelby blob name from chain ───────────────────────────
  let fullBlobName: string;
  try {
    fullBlobName = await getOnChainBlobName(datasetAddr);
  } catch (err) {
    console.error("[download] failed to read blob name from chain:", err);
    return NextResponse.json(
      { error: "Could not resolve dataset blob name." },
      { status: 502 }
    );
  }

  const { account, blobPath } = parseBlobName(fullBlobName);

  // ── 5. Stream from Shelby ────────────────────────────────────────────────
  const shelby = getShelbyClient();

  let shelbyBlob: Awaited<ReturnType<typeof shelby.rpc.getBlob>>;
  try {
    shelbyBlob = await shelby.rpc.getBlob({ account, blobName: blobPath });
  } catch (err) {
    console.error("[download] Shelby RPC fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to retrieve dataset from storage." },
      { status: 502 }
    );
  }

  const filename = blobPath.split("/").pop() ?? "dataset";

  return new NextResponse(shelbyBlob.readable as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(shelbyBlob.contentLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
