/**
 * POST /api/datasets/upload
 *
 * Accepts a dataset file and registers it on the Shelby network (Shelbynet)
 * using the app's publisher key. Returns the Shelby blob name and commitment
 * bytes so the client can submit the marketplace registration transaction.
 *
 * Architecture note:
 *   Shelbynet (chain ID 110) and Aptos testnet (chain ID 2) are different
 *   chains. The user's wallet can only be on one chain at a time, so:
 *     - Shelby blob registration → server signs on Shelbynet (this route)
 *     - Marketplace dataset registration → user's wallet signs on Aptos testnet
 *
 * Request: multipart/form-data
 *   file          — the dataset file
 *   sellerAddress — the seller's Aptos testnet address (for blob path namespacing)
 *
 * Response JSON:
 *   shelbyBlobName  — full blob identifier: "<publisherAddr>/<blobPath>"
 *   commitmentBytes — hex merkle root bytes (number[]) for the marketplace tx
 *   blobSize        — byte length of the uploaded file
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getShelbyClient,
  getMarketplaceSigner,
  buildBlobPath,
  defaultExpirationMicros,
  merkleRootToBytes,
} from "@/lib/shelby";
import { generateCommitments, createDefaultErasureCodingProvider } from "@shelby-protocol/sdk/node";

export async function POST(req: NextRequest) {
  // ── 1. Parse request ───────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileField = formData.get("file");
  const sellerAddress = formData.get("sellerAddress");

  if (!(fileField instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  if (typeof sellerAddress !== "string" || !sellerAddress) {
    return NextResponse.json({ error: "Missing sellerAddress field" }, { status: 400 });
  }

  // ── 2. Read file data ──────────────────────────────────────────────────────
  const blobData = new Uint8Array(await fileField.arrayBuffer());
  const blobPath = buildBlobPath(sellerAddress, fileField.name);

  // ── 3. Get Shelby client and publisher signer ──────────────────────────────
  let shelby: ReturnType<typeof getShelbyClient>;
  let signer: ReturnType<typeof getMarketplaceSigner>;
  try {
    shelby = getShelbyClient();
    signer = getMarketplaceSigner();
  } catch (err) {
    console.error("[upload] Shelby client/signer init failed:", err);
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // ── 4. Compute erasure-code commitments ────────────────────────────────────
  let commitments: Awaited<ReturnType<typeof generateCommitments>>;
  try {
    const provider = await createDefaultErasureCodingProvider();
    commitments = await generateCommitments(provider, blobData);
  } catch (err) {
    console.error("[upload] Commitment generation failed:", err);
    return NextResponse.json(
      { error: "Failed to compute blob commitments" },
      { status: 500 }
    );
  }

  // ── 5. Register blob commitment on Shelbynet + upload data to RPC ─────────
  try {
    await shelby.upload({
      blobData,
      signer,
      blobName: blobPath,
      expirationMicros: defaultExpirationMicros(),
    });
  } catch (err) {
    console.error("[upload] Shelby upload failed:", err);
    return NextResponse.json(
      { error: "Failed to upload dataset to Shelby storage" },
      { status: 502 }
    );
  }

  // ── 6. Build response for client ───────────────────────────────────────────
  const publisherAddress = signer.accountAddress.toString();
  const shelbyBlobName = `${publisherAddress}/${blobPath}`;
  const commitmentBytes = merkleRootToBytes(commitments.blob_merkle_root);

  return NextResponse.json({
    shelbyBlobName,
    commitmentBytes,
    blobSize: blobData.length,
  });
}
