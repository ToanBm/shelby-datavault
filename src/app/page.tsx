"use client";

import { useState, useEffect, useMemo } from "react";
import { Header } from "@/components/marketplace/Header";
import { DatasetCard, type Dataset } from "@/components/marketplace/DatasetCard";
import Link from "next/link";
import { aptosClient } from "@/utils/aptosClient";
import { MODULE_ADDRESS } from "@/constants";

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}

async function fetchAllDatasets(): Promise<Dataset[]> {
  const aptos = aptosClient();
  const [countRaw] = await aptos.view({
    payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_count`, typeArguments: [], functionArguments: [] },
  });
  const count = Number(countRaw);
  const results: Dataset[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const [addrRaw] = await aptos.view({
        payload: { function: `${MODULE_ADDRESS}::dataset_registry::get_dataset_address`, typeArguments: [], functionArguments: [i] },
      });
      const datasetAddr = addrRaw as string;
      const resource = await aptos.getAccountResource({
        accountAddress: datasetAddr,
        resourceType: `${MODULE_ADDRESS}::dataset_registry::DatasetInfo`,
      }) as {
        name: string; description: string; owner: string;
        size_bytes: string; price_octas: string; download_count: string;
        is_active: boolean; tags: string[];
      };

      if (!resource.is_active) continue;

      const { name, description, owner, size_bytes, price_octas, download_count } = resource;

      results.push({
        id: String(i),
        datasetAddr,
        name,
        description,
        price: Number(price_octas) / 1e8,
        tags: [],
        size: formatSize(Number(size_bytes)),
        downloads: Number(download_count),
        seller: owner.slice(0, 8) + "…" + owner.slice(-6),
      });
    } catch {
      // skip unreadable datasets
    }
  }
  return results;
}

export default function HomePage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [query,    setQuery]    = useState("");

  useEffect(() => {
    fetchAllDatasets()
      .then(setDatasets)
      .catch(() => setDatasets([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!query) return datasets;
    const q = query.toLowerCase();
    return datasets.filter((d) =>
      d.name.toLowerCase().includes(q) ||
      d.seller.toLowerCase().includes(q)
    );
  }, [query, datasets]);

  const totalVolume    = datasets.reduce((s, d) => s + d.price, 0);
  const totalDownloads = datasets.reduce((s, d) => s + d.downloads, 0);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header />

      {/* ── Masthead ── */}
      <section style={{ maxWidth: "1280px", margin: "0 auto", padding: "3rem 2rem 0" }}>

        {/* Headline row */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: "1.5rem", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.125rem", color: "var(--ink-light)", marginBottom: "0.25rem" }}>
              The open archive for
            </p>
            <h1 style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "clamp(2.75rem, 6vw, 5rem)",
              lineHeight: 0.92,
              letterSpacing: "-0.02em",
              color: "var(--ink)",
            }}>
              AI Training Data
            </h1>
          </div>

          {/* Stats */}
          <div style={{ display: "flex", gap: "2.5rem", alignSelf: "flex-end", paddingBottom: "0.2rem" }}>
            {[
              { label: "Datasets",  value: loading ? "—" : String(datasets.length) },
              { label: "Volume",    value: loading ? "—" : `${totalVolume.toFixed(2)} APT` },
              { label: "Downloads", value: loading ? "—" : new Intl.NumberFormat("en-US").format(totalDownloads) },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.625rem", color: "var(--ink)", lineHeight: 1 }}>
                  {s.value}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 600, color: "var(--ink-mid)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "3px" }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Editorial double-rule divider */}
        <div style={{ borderTop: "3px solid var(--ink)", borderBottom: "1px solid var(--ink)", height: "5px" }} />

        {/* Tagline + CTA */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", padding: "0.875rem 0 1.25rem" }}>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "var(--ink-light)", fontStyle: "italic" }}>
            Decentralized storage via Shelby Protocol · On-chain ownership via Aptos · Clay Codes erasure coding
          </p>
          <Link
            href="/upload"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.68rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--terra)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "gap 0.15s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.gap = "10px"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.gap = "6px"; }}
          >
            Deposit a dataset
            <span>→</span>
          </Link>
        </div>
      </section>

      {/* ── Search + Grid ── */}
      <section style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 2rem 5rem" }}>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: "2rem" }}>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or depositor…"
            className="field-input"
            style={{ paddingLeft: "1.5rem", fontSize: "0.9375rem" }}
          />
        </div>

        {/* Count */}
        <div style={{ marginBottom: "1.25rem", fontFamily: "var(--font-mono)", fontSize: "0.63rem", color: "var(--ink-light)" }}>
          {loading ? "Loading archive…" : `${filtered.length} specimen${filtered.length !== 1 ? "s" : ""}`}
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "5rem 1rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--ink-faint)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Loading archive…
          </div>
        ) : filtered.length > 0 ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
            gap: "1rem",
          }}>
            {filtered.map((d, i) => <DatasetCard key={d.datasetAddr} dataset={d} index={i} />)}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "5rem 1rem" }}>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.5rem", color: "var(--ink-faint)", marginBottom: "0.5rem" }}>
              No specimens found
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "var(--ink-faint)" }}>
              {datasets.length === 0 ? "Be the first to deposit a dataset." : "Try adjusting your search."}
            </div>
          </div>
        )}
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: "1px solid var(--stroke)", padding: "1.5rem 2rem" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.875rem", letterSpacing: "0.12em", color: "var(--ink-light)", textTransform: "uppercase" }}>
            DataVault
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--ink-faint)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Aptos Blockchain · Shelby Protocol Storage · Testnet
          </span>
        </div>
      </footer>
    </div>
  );
}
