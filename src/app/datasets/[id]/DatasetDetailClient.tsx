"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/marketplace/Header";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { aptosClient } from "@/utils/aptosClient";
import { MODULE_ADDRESS } from "@/constants";
import { AccountAddress } from "@aptos-labs/ts-sdk";

type DatasetInfo = {
  datasetAddr: string;
  name: string;
  owner: string;
  sizeBytes: number;
  price: number;      // octas
  downloads: number;
  isActive: boolean;
};

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}

export default function DatasetDetailClient() {
  const { id } = useParams<{ id: string }>();
  const { account, signAndSubmitTransaction, signMessage } = useWallet();
  const [dataset,     setDataset]    = useState<DatasetInfo | null>(null);
  const [loading,     setLoading]    = useState(true);
  const [notFound,    setNotFound]   = useState(false);
  const [purchasing,  setPurchasing]  = useState(false);
  const [purchased,   setPurchased]   = useState(false);
  const [hasAccess,   setHasAccess]   = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // id is the dataset object address on-chain
  const datasetAddr = id;

  useEffect(() => {
    if (!datasetAddr) return;
    setLoading(true);
    const aptos = aptosClient();
    aptos.view({
      payload: {
        function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_info`,
        typeArguments: [],
        functionArguments: [datasetAddr],
      },
    }).then(([, owner, name, , sizeRaw, priceRaw, dlRaw, isActive]) => {
      setDataset({
        datasetAddr,
        name: name as string,
        owner: owner as string,
        sizeBytes: Number(sizeRaw),
        price: Number(priceRaw),
        downloads: Number(dlRaw),
        isActive: isActive as boolean,
      });
    }).catch(() => {
      setNotFound(true);
    }).finally(() => setLoading(false));
  }, [datasetAddr]);

  // Check if connected wallet already has access (buyer or owner)
  useEffect(() => {
    if (!account || !datasetAddr || !dataset) return;
    const walletAddr = account.address.toString();

    // Owner always has access to their own dataset
    try {
      const ownerNorm = AccountAddress.fromString(dataset.owner).toString();
      const walletNorm = AccountAddress.fromString(walletAddr).toString();
      if (ownerNorm === walletNorm) { setHasAccess(true); return; }
    } catch { /* fall through */ }

    const aptos = aptosClient();
    aptos.view({
      payload: {
        function: `${MODULE_ADDRESS}::marketplace::has_access`,
        typeArguments: [],
        functionArguments: [walletAddr, datasetAddr],
      },
    }).then(([result]) => {
      if (result) setHasAccess(true);
    }).catch(() => {});
  }, [account, datasetAddr, dataset]);

  const handlePurchase = async () => {
    if (!account) { setError("Connect your wallet to purchase."); return; }
    setError(null); setPurchasing(true);
    try {
      const res = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::marketplace::purchase_dataset` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [datasetAddr],
        },
      });
      await aptosClient().waitForTransaction({ transactionHash: res.hash });
      setPurchased(true);
      setHasAccess(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Transaction failed");
      return;
    } finally { setPurchasing(false); }

    // Purchase confirmed — immediately kick off the download
    await handleDownload();
  };

  const handleDownload = async () => {
    if (!account || !signMessage) { setError("Connect your wallet to download."); return; }
    setDownloading(true);
    setError(null);
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Failed to obtain download nonce.");
      const { nonce } = await nonceRes.json();
      const signed = await signMessage({ message: "DataVault download auth", nonce });
      const res = await fetch(`/api/datasets/${datasetAddr}/download`, {
        headers: {
          "x-buyer-address": account.address.toString(),
          "x-nonce":         nonce,
          "x-signature":     signed.signature.toString(),
          "x-public-key":    account.publicKey?.toString() ?? "",
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Download failed." }));
        throw new Error(body.error ?? "Download failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (dataset?.name ?? "dataset").replace(/[^a-zA-Z0-9]/g, "_");
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally { setDownloading(false); }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Header />
        <div style={{ maxWidth: "600px", margin: "8rem auto", padding: "0 2rem", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--ink-faint)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Loading specimen…
        </div>
      </div>
    );
  }

  if (notFound || !dataset) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Header />
        <div style={{ maxWidth: "600px", margin: "8rem auto", padding: "0 2rem", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "4rem", color: "var(--stroke)", lineHeight: 1, marginBottom: "1rem" }}>404</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.75rem", color: "var(--ink)", marginBottom: "0.75rem" }}>Specimen not found</h1>
          <p style={{ fontFamily: "var(--font-body)", color: "var(--ink-light)", marginBottom: "2rem", lineHeight: 1.6 }}>This dataset does not exist in the archive or has been withdrawn.</p>
          <Link href="/" style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--terra)" }}>
            ← Return to archive
          </Link>
        </div>
      </div>
    );
  }

  const isFree = dataset.price === 0;
  const canDownload = isFree || purchased || hasAccess;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header />

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2.5rem 2rem 5rem" }}>

        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 600, color: "var(--ink-mid)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2rem" }}>
          <Link href="/">Archive</Link>
          <span>/</span>
          <span>{dataset.name.slice(0, 45)}{dataset.name.length > 45 ? "…" : ""}</span>
        </div>

        {/* Top rule */}
        <div style={{ borderTop: "3px solid var(--ink)", borderBottom: "1px solid var(--ink)", height: "5px", marginBottom: "2.5rem" }} />

        {/* Two-column */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "3rem", alignItems: "start" }}>

          {/* ── Left: Specimen details ── */}
          <div>
            {/* Title */}
            <h1 style={{
              fontFamily: "var(--font-display)", fontWeight: 700,
              fontSize: "clamp(1.75rem, 4vw, 2.75rem)",
              color: "var(--ink)", lineHeight: 1.1, marginBottom: "2rem",
            }}>
              {dataset.name}
            </h1>

            {/* Metadata table */}
            <div style={{ borderTop: "1px solid var(--stroke)", marginBottom: "2rem" }}>
              {[
                { label: "Size",      value: formatSize(dataset.sizeBytes) },
                { label: "Downloads", value: dataset.downloads.toLocaleString("en-US") },
                { label: "Status",    value: dataset.isActive ? "Active" : "Inactive" },
              ].map((row) => (
                <div key={row.label} style={{
                  display: "grid", gridTemplateColumns: "160px 1fr",
                  gap: "1rem", padding: "0.75rem 0",
                  borderBottom: "1px solid var(--stroke-light)",
                }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.63rem", color: "var(--ink-light)", letterSpacing: "0.08em", textTransform: "uppercase", paddingTop: "1px" }}>
                    {row.label}
                  </span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "var(--ink-mid)" }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Provenance */}
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.25rem", color: "var(--ink)", marginBottom: "0.875rem" }}>
                Provenance record
              </h2>
              <div className="surface" style={{ padding: "1rem 1.25rem" }}>
                {[
                  { label: "Object address", value: dataset.datasetAddr },
                  { label: "Depositor",      value: dataset.owner },
                  { label: "Storage layer",  value: "Shelby Protocol — testnet" },
                  { label: "Erasure coding", value: "Clay Codes (10 data + 6 parity chunks)" },
                  { label: "Settlement",     value: "Aptos blockchain" },
                ].map((row, i, arr) => (
                  <div key={row.label} style={{
                    display: "grid", gridTemplateColumns: "150px 1fr",
                    gap: "1rem", padding: "0.625rem 0",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--stroke-light)" : "none",
                  }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--ink-light)", letterSpacing: "0.08em", textTransform: "uppercase", paddingTop: "1px" }}>
                      {row.label}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--accent-blue)", wordBreak: "break-all" }}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right: Acquisition card ── */}
          <div style={{ position: "sticky", top: "80px" }}>
            <div className="surface" style={{ padding: "1.5rem" }}>

              {/* Price */}
              <div style={{ borderBottom: "1px solid var(--stroke-light)", paddingBottom: "1.25rem", marginBottom: "1.25rem" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 600, color: "var(--ink-mid)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "6px" }}>
                  Acquisition price
                </div>
                {isFree ? (
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "2.5rem", color: "var(--accent-green)", lineHeight: 1 }}>
                    Gratis
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "2.5rem", color: "var(--terra)", lineHeight: 1 }}>
                      {(dataset.price / 1e8).toFixed(2)}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--ink-faint)" }}>APT</span>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  padding: "0.625rem 0.75rem", marginBottom: "1rem",
                  background: "rgba(192,57,10,0.08)", border: "1px solid rgba(192,57,10,0.25)",
                  borderRadius: "2px", color: "var(--terra)",
                  fontFamily: "var(--font-body)", fontSize: "0.8rem", lineHeight: 1.5,
                }}>
                  {error}
                </div>
              )}

              {/* Action button */}
              {canDownload ? (
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  style={{
                    width: "100%", padding: "0.875rem",
                    background: downloading ? "transparent" : "var(--ink)",
                    color: downloading ? "var(--ink-light)" : "var(--parchment)",
                    border: downloading ? "1px solid var(--stroke)" : "none",
                    borderRadius: "1px",
                    fontFamily: "var(--font-mono)", fontWeight: 500,
                    fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase",
                    cursor: downloading ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    transition: "all 0.15s ease",
                  }}
                >
                  {downloading
                    ? <><span style={{ display: "inline-block", animation: "spin 0.9s linear infinite" }}>◌</span>Preparing download…</>
                    : "↓ Download Specimen"
                  }
                </button>
              ) : (
                <button
                  onClick={handlePurchase}
                  disabled={purchasing || !account}
                  style={{
                    width: "100%", padding: "0.875rem",
                    background: !account ? "transparent" : purchasing ? "transparent" : "var(--terra)",
                    color: !account ? "var(--ink-faint)" : purchasing ? "var(--terra)" : "var(--parchment-card)",
                    border: !account ? "1px solid var(--stroke)" : purchasing ? "1px solid rgba(192,57,10,0.35)" : "none",
                    borderRadius: "1px",
                    fontFamily: "var(--font-mono)", fontWeight: 500,
                    fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase",
                    cursor: purchasing || !account ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    transition: "all 0.15s ease",
                  }}
                >
                  {!account
                    ? "Connect wallet to acquire"
                    : purchasing
                      ? <><span style={{ display: "inline-block", animation: "spin 0.9s linear infinite" }}>◌</span>Confirming…</>
                      : `Acquire for ${(dataset.price / 1e8).toFixed(2)} APT`
                  }
                </button>
              )}

              {/* Trust signals */}
              <div style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {[
                  "Ownership recorded on Aptos",
                  "Erasure-coded via Shelby Protocol",
                  "Immediate access upon purchase",
                ].map((text) => (
                  <div key={text} style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "var(--ink-light)", fontStyle: "italic" }}>
                    <span style={{ color: "var(--terra)", fontSize: "0.6rem", flexShrink: 0 }}>✦</span>
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
