"use client";

import Link from "next/link";

export interface Dataset {
  id: string;
  datasetAddr: string;
  name: string;
  description: string;
  price: number;      // APT (already divided by 1e8)
  tags: string[];
  size: string;
  downloads: number;
  seller: string;
}

const TAG_STYLES: Record<string, { bg: string; color: string }> = {
  "nlp":               { bg: "rgba(192,57,10,0.1)",   color: "#8b2200" },
  "computer-vision":   { bg: "rgba(29,68,112,0.1)",   color: "#1d4470" },
  "tabular":           { bg: "rgba(37,98,58,0.1)",    color: "#25623a" },
  "audio":             { bg: "rgba(153,93,0,0.1)",    color: "#7a4a00" },
  "code":              { bg: "rgba(26,18,9,0.08)",    color: "#3d3226" },
  "multimodal":        { bg: "rgba(85,45,115,0.1)",   color: "#4a2060" },
  "science":           { bg: "rgba(37,98,58,0.1)",    color: "#25623a" },
  "finance":           { bg: "rgba(153,93,0,0.1)",    color: "#7a4a00" },
  "medical":           { bg: "rgba(139,0,60,0.1)",    color: "#8b003c" },
  "speech":            { bg: "rgba(153,93,0,0.1)",    color: "#7a4a00" },
  "3d":                { bg: "rgba(29,68,112,0.1)",   color: "#1d4470" },
  "video":             { bg: "rgba(29,68,112,0.1)",   color: "#1d4470" },
  "multilingual":      { bg: "rgba(192,57,10,0.1)",   color: "#8b2200" },
  "instruction-tuning":{ bg: "rgba(192,57,10,0.1)",   color: "#8b2200" },
};

function TagBadge({ tag }: { tag: string }) {
  const s = TAG_STYLES[tag] ?? { bg: "rgba(26,18,9,0.08)", color: "#3d3226" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 7px",
      fontSize: "0.58rem",
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.color}40`,
      borderRadius: "1px",
      whiteSpace: "nowrap",
    }}>
      {tag}
    </span>
  );
}

export function DatasetCard({ dataset, index }: { dataset: Dataset; index: number }) {
  const classNum = `DS-${String(index + 1).padStart(4, "0")}`;
  const stagger = `stagger-${Math.min(index + 1, 10)}`;

  return (
    <Link href={`/datasets/${dataset.datasetAddr}`} style={{ display: "block", textDecoration: "none" }}>
      <div
        className={`catalog-card animate-fade-up ${stagger}`}
        style={{ padding: "1.25rem 1.25rem 1rem", display: "flex", flexDirection: "column", gap: "0.625rem", height: "100%" }}
      >
        {/* Classification number + downloads */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--ink-light)", letterSpacing: "0.1em" }}>
            {classNum}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--ink-light)", display: "flex", alignItems: "center", gap: "3px" }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {dataset.downloads.toLocaleString("en-US")}
          </span>
        </div>

        {/* Tags — only rendered when present */}
        {dataset.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {dataset.tags.slice(0, 3).map((tag) => <TagBadge key={tag} tag={tag} />)}
            {dataset.tags.length > 3 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--ink-light)", alignSelf: "center" }}>
                +{dataset.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Title */}
        <h3 style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "1.0625rem",
          color: "var(--ink)",
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {dataset.name}
        </h3>

        {/* Description */}
        <p className="card-description" style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.8125rem",
          color: "var(--ink-mid)",
          lineHeight: 1.6,
        }}>
          {dataset.description || "—"}
        </p>

        {/* Spacer — pushes footer to bottom regardless of title/description length */}
        <div style={{ flex: 1 }} />

        {/* Footer */}
        <div style={{
          borderTop: "1px solid var(--stroke-light)",
          paddingTop: "0.75rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.63rem", color: "var(--ink-light)" }}>
            {dataset.size}
          </span>

          {dataset.price === 0 ? (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: "0.63rem",
              letterSpacing: "0.08em",
              background: "rgba(37,98,58,0.1)", color: "var(--accent-green)",
              border: "1px solid rgba(37,98,58,0.3)",
              padding: "2px 9px", borderRadius: "1px",
            }}>
              GRATIS
            </span>
          ) : (
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.125rem", color: "var(--terra)" }}>
              {dataset.price % 1 === 0 ? dataset.price.toFixed(0) : dataset.price.toFixed(2)}{" "}
              <span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 400, color: "var(--ink-light)" }}>APT</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
