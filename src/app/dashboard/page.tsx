"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Header } from "@/components/marketplace/Header";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { aptosClient } from "@/utils/aptosClient";
import { MODULE_ADDRESS } from "@/constants";
import { AccountAddress } from "@aptos-labs/ts-sdk";

function normalizeAddr(addr: string): string {
  try { return AccountAddress.fromString(addr).toString(); } catch { return addr.toLowerCase(); }
}

type Listing = {
  id: string;
  name: string;
  price: number;
  downloads: number;
  earnings: number;
  size: string;
  isActive: boolean;
  datasetAddr: string;
  listedAt: string;
};

type Purchase = {
  id: string;
  name: string;
  price: number;
  size: string;
  datasetAddr: string;
};

async function fetchListings(ownerAddress: string): Promise<Listing[]> {
  const aptos = aptosClient();
  console.log("[dashboard] MODULE_ADDRESS:", MODULE_ADDRESS);
  console.log("[dashboard] ownerAddress:", ownerAddress);
  const [countRaw] = await aptos.view({
    payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_count`, typeArguments: [], functionArguments: [] },
  });
  const count = Number(countRaw);
  console.log("[dashboard] dataset count:", count);
  const listings: Listing[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const [addr] = await aptos.view({
        payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_address`, typeArguments: [], functionArguments: [i] },
      });
      const datasetAddr = addr as string;
      const [id, owner, name, , sizeBytesRaw, priceRaw, downloadsRaw, isActive] = await aptos.view({
        payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_info`, typeArguments: [], functionArguments: [datasetAddr] },
      }) as [number, string, string, string, number, number, number, boolean];

      console.log(`[dashboard] dataset ${i}: addr=${datasetAddr} owner=${owner} name=${name}`);
      if (normalizeAddr(owner as string) !== normalizeAddr(ownerAddress)) continue;

      const sizeBytes = Number(sizeBytesRaw);
      const price     = Number(priceRaw);
      const downloads = Number(downloadsRaw);
      const [earningsRaw] = await aptos.view({
        payload: { function: `${MODULE_ADDRESS}::marketplace::get_seller_earnings`, typeArguments: [], functionArguments: [ownerAddress] },
      });

      const fmt = (b: number) =>
        b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` :
        b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(1)} GB`;

      listings.push({
        id: String(id),
        name: name as string,
        price,
        downloads,
        earnings: Number(earningsRaw),
        size: fmt(sizeBytes),
        isActive: isActive as boolean,
        datasetAddr,
        listedAt: new Date().toISOString().slice(0, 10),
      });
    } catch {
      // skip datasets that can't be read
    }
  }
  return listings;
}

async function fetchPurchases(buyerAddress: string): Promise<Purchase[]> {
  const aptos = aptosClient();
  const [countRaw] = await aptos.view({
    payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_count`, typeArguments: [], functionArguments: [] },
  });
  const count = Number(countRaw);
  const purchases: Purchase[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const [addr] = await aptos.view({
        payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_address`, typeArguments: [], functionArguments: [i] },
      });
      const datasetAddr = addr as string;
      const [hasAccess] = await aptos.view({
        payload: { function: `${MODULE_ADDRESS}::marketplace::has_access`, typeArguments: [], functionArguments: [buyerAddress, datasetAddr] },
      });
      if (!hasAccess) continue;

      const [id, owner, name, , sizeBytesRaw, priceRaw] = await aptos.view({
        payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_info`, typeArguments: [], functionArguments: [datasetAddr] },
      }) as [number, string, string, string, number, number, number, boolean];

      if (normalizeAddr(owner as string) === normalizeAddr(buyerAddress)) continue; // skip own listings

      const fmt = (b: number) =>
        b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` :
        b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(1)} GB`;

      purchases.push({
        id: String(id),
        name: name as string,
        price: Number(priceRaw),
        size: fmt(Number(sizeBytesRaw)),
        datasetAddr,
      });
    } catch {
      // skip
    }
  }
  return purchases;
}

type Tab = "listings" | "purchases";


function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface" style={{ padding: "1.25rem 1.5rem" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 600, color: "var(--ink-mid)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.875rem", color: "var(--ink)", lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontFamily: "var(--font-body)", fontSize: "0.72rem", color: "var(--ink-faint)", marginTop: "4px", fontStyle: "italic" }}>{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { account } = useWallet();
  const [tab,         setTab]        = useState<Tab>("listings");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dlError,     setDlError]    = useState<string | null>(null);
  const [listings,    setListings]   = useState<Listing[]>([]);
  const [purchases,   setPurchases]  = useState<Purchase[]>([]);
  const [loading,     setLoading]    = useState(false);
  const [fetchError,  setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setLoading(true);
    setFetchError(null);
    const addr = account.address.toString();
    Promise.all([fetchListings(addr), fetchPurchases(addr)])
      .then(([l, p]) => { setListings(l); setPurchases(p); })
      .catch((e) => setFetchError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [account]);

  const totalEarnings  = listings.reduce((s, d) => s + d.earnings, 0);
  const totalDownloads = listings.reduce((s, d) => s + d.downloads, 0);

  const handleDownload = async (datasetAddr: string, name: string) => {
    if (!account) return;
    setDlError(null); setDownloading(datasetAddr);
    try {
      const res = await fetch(`/api/datasets/${datasetAddr}/download`, {
        headers: { "x-buyer-address": account.address.toString() },
      });
      if (!res.ok) { const { error: msg } = await res.json(); throw new Error(msg ?? "Download failed"); }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = name.replace(/[^a-zA-Z0-9]/g, "_"); a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setDlError(e instanceof Error ? e.message : "Download failed");
    } finally { setDownloading(null); }
  };

  if (!account) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Header />
        <div style={{ maxWidth: "520px", margin: "8rem auto", padding: "0 2rem", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.25rem", color: "var(--ink-faint)", marginBottom: "1rem" }}>Restricted access</div>
          <div style={{ borderTop: "3px solid var(--ink)", borderBottom: "1px solid var(--ink)", height: "5px", marginBottom: "2rem" }} />
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "2rem", color: "var(--ink)", marginBottom: "0.875rem" }}>Connect your wallet</h1>
          <p style={{ fontFamily: "var(--font-body)", color: "var(--ink-light)", lineHeight: 1.7 }}>
            Connect an Aptos wallet to view your deposited specimens, acquisition history, and earnings ledger.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "3rem 2rem 6rem" }}>

        {/* Page header */}
        <div style={{ marginBottom: "2rem" }}>
          <p style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1rem", color: "var(--ink-light)", marginBottom: "0.2rem" }}>Account ledger</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(1.75rem, 3vw, 2.5rem)", color: "var(--ink)", lineHeight: 0.95, marginBottom: "0.375rem" }}>
                My Archive
              </h1>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--accent-blue)", letterSpacing: "0.08em" }}>
                {account.address.toString().slice(0, 12)}…{account.address.toString().slice(-8)}
              </div>
            </div>
            <Link href="/upload" style={{
              padding: "0.6rem 1.25rem",
              background: "var(--ink)", color: "var(--parchment-card)",
              borderRadius: "1px",
              fontFamily: "var(--font-mono)", fontSize: "0.65rem",
              letterSpacing: "0.1em", textTransform: "uppercase",
              display: "inline-flex", alignItems: "center", gap: "6px",
            }}>
              + Deposit Specimen
            </Link>
          </div>
        </div>

        <div style={{ borderTop: "3px solid var(--ink)", borderBottom: "1px solid var(--ink)", height: "5px", marginBottom: "2.5rem" }} />

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2.5rem" }}>
          <StatCard label="Total Earnings"    value={`${(totalEarnings / 1e8).toFixed(2)} APT`} sub="from dataset sales" />
          <StatCard label="Total Downloads"   value={totalDownloads.toLocaleString("en-US")} sub="across all specimens" />
          <StatCard label="Active Specimens"  value={String(listings.filter((d) => d.isActive).length)} />
          <StatCard label="Acquired"          value={String(purchases.length)} sub="specimens in collection" />
        </div>

        {/* Fetch error */}
        {fetchError && (
          <div style={{ padding: "0.75rem 1rem", marginBottom: "1.5rem", background: "rgba(192,57,10,0.08)", border: "1px solid rgba(192,57,10,0.25)", borderRadius: "1px", color: "var(--terra)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", wordBreak: "break-all" }}>
            {fetchError}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--ink-faint)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.5rem" }}>
            Loading archive…
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--stroke)", marginBottom: "0" }}>
          {(["listings", "purchases"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "0.625rem 1.5rem",
                background: "transparent", border: "none",
                borderBottom: tab === t ? "2px solid var(--terra)" : "2px solid transparent",
                color: tab === t ? "var(--terra)" : "var(--ink-light)",
                fontFamily: "var(--font-mono)", fontSize: "0.65rem",
                letterSpacing: "0.1em", textTransform: "uppercase",
                cursor: "pointer", marginBottom: "-1px",
                transition: "color 0.14s ease",
              }}
            >
              {t === "listings" ? `Deposited (${listings.length})` : `Acquired (${purchases.length})`}
            </button>
          ))}
        </div>

        {/* Download error */}
        {dlError && (
          <div style={{ padding: "0.75rem 1rem", margin: "1rem 0", background: "rgba(192,57,10,0.08)", border: "1px solid rgba(192,57,10,0.25)", borderRadius: "1px", color: "var(--terra)", fontFamily: "var(--font-body)", fontSize: "0.82rem" }}>
            {dlError}
          </div>
        )}

        {/* ── Listings tab ── */}
        {tab === "listings" && (
          <div className="surface" style={{ marginTop: "1px" }}>
            {/* Table header */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 90px 100px 100px 90px",
              gap: "1rem", padding: "0.625rem 1.25rem",
              borderBottom: "1px solid var(--stroke)",
              background: "var(--parchment-deep)",
            }}>
              {["Specimen", "Downloads", "Earnings", "Price", ""].map((h) => (
                <span key={h} style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", fontWeight: 500, color: "var(--ink-light)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
              ))}
            </div>

            {listings.length === 0 ? (
              <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.25rem", color: "var(--ink-faint)", marginBottom: "1rem" }}>No specimens deposited yet</div>
                <Link href="/upload" style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--terra)" }}>
                  Deposit your first dataset →
                </Link>
              </div>
            ) : (
              listings.map((d) => (
                <div key={d.id} style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 100px 100px 90px",
                  gap: "1rem",
                  padding: "1rem 1.25rem",
                  borderBottom: "1px solid var(--stroke-light)",
                  alignItems: "center",
                  transition: "background 0.12s ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(192,57,10,0.025)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                >
                  {/* Name + status */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                    <div style={{
                      width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0,
                      background: d.isActive ? "var(--accent-green)" : "var(--ink-faint)",
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/datasets/${d.datasetAddr}`} style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.9375rem", color: "var(--ink)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.name}
                      </Link>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--ink-light)", marginTop: "2px" }}>
                        {d.listedAt} · {d.size}
                      </div>
                    </div>
                  </div>

                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1rem", color: "var(--ink)" }}>{d.downloads.toLocaleString("en-US")}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1rem", color: d.earnings > 0 ? "var(--terra)" : "var(--ink-faint)" }}>
                    {d.price === 0 ? "—" : `${(d.earnings / 1e8).toFixed(0)} APT`}
                  </span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1rem", color: d.price === 0 ? "var(--accent-green)" : "var(--terra)" }}>
                    {d.price === 0 ? "Gratis" : `${(d.price / 1e8).toFixed(2)} APT`}
                  </span>
                  <Link href={`/datasets/${d.datasetAddr}`} style={{
                    fontFamily: "var(--font-mono)", fontSize: "0.6rem",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    color: "var(--ink-light)", textDecoration: "none",
                  }}>
                    View →
                  </Link>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Purchases tab ── */}
        {tab === "purchases" && (
          <div className="surface" style={{ marginTop: "1px" }}>
            {/* Table header */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 100px 120px 110px",
              gap: "1rem", padding: "0.625rem 1.25rem",
              borderBottom: "1px solid var(--stroke)",
              background: "var(--parchment-deep)",
            }}>
              {["Specimen", "Paid", "Acquired", ""].map((h) => (
                <span key={h} style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", fontWeight: 500, color: "var(--ink-light)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
              ))}
            </div>

            {purchases.length === 0 ? (
              <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.25rem", color: "var(--ink-faint)", marginBottom: "1rem" }}>No acquisitions yet</div>
                <Link href="/" style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--terra)" }}>
                  Browse the archive →
                </Link>
              </div>
            ) : (
              purchases.map((d) => (
                <div key={d.id} style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 120px 110px",
                  gap: "1rem",
                  padding: "1rem 1.25rem",
                  borderBottom: "1px solid var(--stroke-light)",
                  alignItems: "center",
                  transition: "background 0.12s ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(192,57,10,0.025)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/datasets/${d.datasetAddr}`} style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.9375rem", color: "var(--ink)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.name}
                    </Link>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--ink-light)", marginTop: "2px" }}>{d.size}</div>
                  </div>

                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1rem", color: "var(--terra)" }}>{d.price === 0 ? "Gratis" : `${(d.price / 1e8).toFixed(2)} APT`}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--ink-light)" }}>{d.size}</span>

                  <button
                    onClick={() => handleDownload(d.datasetAddr, d.name)}
                    disabled={downloading === d.datasetAddr}
                    style={{
                      padding: "0.4rem 0.875rem",
                      background: "transparent",
                      border: "1px solid var(--stroke)",
                      color: downloading === d.datasetAddr ? "var(--ink-faint)" : "var(--ink)",
                      borderRadius: "1px",
                      fontFamily: "var(--font-mono)", fontSize: "0.6rem",
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      cursor: downloading === d.datasetAddr ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", gap: "5px",
                      transition: "all 0.14s ease",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { if (downloading !== d.datasetAddr) { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--terra)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--terra)"; } }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--stroke)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--ink)"; }}
                  >
                    {downloading === d.datasetAddr
                      ? <><span style={{ display: "inline-block", animation: "spin 0.9s linear infinite" }}>◌</span>Retrieving</>
                      : <>↓ Retrieve</>
                    }
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
