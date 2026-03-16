/**
 * GET /api/auth/nonce
 *
 * Issues a single-use, time-limited nonce for download authentication.
 * The client passes this nonce to their wallet's signMessage(), then presents
 * the signature to the download route.
 *
 * Response: { nonce: string }
 */

import { NextResponse } from "next/server";
import { createNonce } from "@/lib/nonceStore";

export async function GET() {
  return NextResponse.json({ nonce: createNonce() });
}
