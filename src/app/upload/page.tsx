"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/marketplace/Header";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { MODULE_ADDRESS } from "@/constants";

// ── Constants ────────────────────────────────────────────────────────────────

const TAGS = ["nlp","computer-vision","tabular","audio","code","multimodal","science","finance","medical","speech","3d","video","multilingual","instruction-tuning"];
const LICENSES = ["CC-BY-4.0","CC-BY-NC-4.0","CC-BY-NC-SA-4.0","CC0","MIT","Apache-2.0","Proprietary (single user)"];

const fmt = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` :
  b < 1073741824 ? `${(b/1048576).toFixed(1)} MB` : `${(b/1073741824).toFixed(1)} GB`;

// ── Template definitions ──────────────────────────────────────────────────────

type Template = {
  id: string;
  icon: string;
  title: string;
  tagline: string;
  name: string;
  description: string;
  file: string;       // path under /templates/
  format: string;
  tags: string[];
  license: string;
};

const TEMPLATES: Template[] = [
  {
    id: "instruction-tuning",
    icon: "◈",
    title: "Instruction Tuning",
    tagline: "LLM fine-tuning & RLHF",
    name: "Instruction Tuning Dataset (Q&A Pairs)",
    description: "10 high-quality prompt–response pairs covering machine learning, coding, knowledge Q&A, translation, and general reasoning. Formatted as JSONL with category labels. Suitable for SFT and RLHF fine-tuning pipelines targeting instruction-following behaviour.",
    file: "/templates/instruction-tuning.jsonl",
    format: "JSONL",
    tags: ["nlp", "instruction-tuning"],
    license: "CC-BY-4.0",
  },
  {
    id: "text-classification",
    icon: "≡",
    title: "Text Classification",
    tagline: "Sentiment & topic labeling",
    name: "Product Review Sentiment Dataset",
    description: "15 labeled product review samples with positive, negative, and neutral sentiment classes. Each row includes the raw text, label, confidence score, and source field. Balanced class distribution suitable for training binary or multiclass sentiment classifiers.",
    file: "/templates/text-classification.csv",
    format: "CSV",
    tags: ["nlp", "tabular"],
    license: "CC-BY-4.0",
  },
  {
    id: "image-labels",
    icon: "⬡",
    title: "Image Labels Index",
    tagline: "Computer vision annotations",
    name: "Image Classification Labels Index",
    description: "15 annotated image records with filename, label, label ID, confidence score, train/val/test split, image dimensions, and annotator ID. Covers 5 common animal classes. Designed to accompany a raw image folder for training CNN or ViT classifiers.",
    file: "/templates/image-labels.csv",
    format: "CSV",
    tags: ["computer-vision", "tabular"],
    license: "CC-BY-4.0",
  },
  {
    id: "code-completion",
    icon: "⌥",
    title: "Code Completion Pairs",
    tagline: "Code LLMs & copilots",
    name: "Python & TypeScript Code Completion Dataset",
    description: "8 code completion pairs in Python and TypeScript spanning algorithms, data structures, async patterns, and utility functions. Each entry includes a docstring prompt and a complete, idiomatic implementation. Difficulty tags (easy/medium/hard) are included for curriculum learning.",
    file: "/templates/code-completion.jsonl",
    format: "JSONL",
    tags: ["code", "nlp"],
    license: "MIT",
  },
  {
    id: "tabular-regression",
    icon: "▦",
    title: "Tabular Regression",
    tagline: "Pricing & forecasting models",
    name: "Real Estate Price Regression Dataset",
    description: "15 residential property records with 11 features including square footage, bedrooms, bathrooms, garage spaces, age, lot size, school rating, distance to city centre, pool, last renovation year, and sale price in USD. Suitable for training gradient boosting, random forest, or linear regression models.",
    file: "/templates/tabular-regression.csv",
    format: "CSV",
    tags: ["tabular", "finance"],
    license: "CC-BY-4.0",
  },
  {
    id: "named-entity-recognition",
    icon: "⊞",
    title: "Named Entity Recognition",
    tagline: "NER & information extraction",
    name: "Named Entity Recognition (NER) Dataset",
    description: "8 annotated sentences in BIO tagging format covering entities: PER (person), ORG (organisation), LOC (location), DATE, MONEY, PERCENT, PRODUCT, TIME, and AWARD. Sourced from news-style sentences with tokenised text and per-token NER labels. Compatible with Hugging Face `datasets` and spaCy.",
    file: "/templates/named-entity-recognition.jsonl",
    format: "JSONL",
    tags: ["nlp"],
    license: "CC-BY-4.0",
  },
  {
    id: "time-series",
    icon: "∿",
    title: "Time Series Forecasting",
    tagline: "Finance, IoT & sensor data",
    name: "Hourly Time Series with Anomaly Labels",
    description: "15 hourly observations with value, 24-hour rolling mean and standard deviation, hour-of-day, day-of-week, weekend flag, 1-hour and 24-hour lags, and binary anomaly label. One labelled anomaly spike is included. Suitable for LSTM, Prophet, or gradient boosting forecasting models.",
    file: "/templates/time-series.csv",
    format: "CSV",
    tags: ["tabular", "finance"],
    license: "CC-BY-4.0",
  },
];

// ── Small components ──────────────────────────────────────────────────────────

type Step = "path" | "templates" | "form" | "uploading" | "confirming" | "done";

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: "block", marginBottom: "0.5rem" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-mid)" }}>
        {children}
      </span>
      {hint && <span style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "var(--ink-faint)", marginLeft: "0.5rem", fontStyle: "italic" }}>{hint}</span>}
    </label>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter();
  const { account, signAndSubmitTransaction } = useWallet();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step,          setStep]          = useState<Step>("path");
  const [statusMsg,     setStatusMsg]     = useState("");
  const [statusDetail,  setStatusDetail]  = useState("");
  const [dragOver,      setDragOver]      = useState(false);
  const [file,          setFile]          = useState<File | null>(null);
  const [name,          setName]          = useState("");
  const [description,   setDescription]   = useState("");
  const [price,         setPrice]         = useState("");
  const [tags,          setTags]          = useState<string[]>([]);
  const [license,       setLicense]       = useState(LICENSES[0]);
  const [error,         setError]         = useState<string | null>(null);
  const [txHash,        setTxHash]        = useState<string | null>(null);
  const [loadingTpl,    setLoadingTpl]    = useState<string | null>(null);

  const toggleTag = (t: string) => setTags((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  const resetForm = () => {
    setStep("path"); setFile(null); setName(""); setDescription("");
    setPrice(""); setTags([]); setLicense(LICENSES[0]); setTxHash(null); setError(null);
  };

  // Load a template: fetch the file, pre-fill form, go to form step
  const selectTemplate = async (tpl: Template) => {
    setLoadingTpl(tpl.id);
    try {
      const res = await fetch(tpl.file);
      if (!res.ok) throw new Error("Could not load template file");
      const blob = await res.blob();
      const filename = tpl.file.split("/").pop()!;
      const tplFile = new File([blob], filename, { type: blob.type || "text/plain" });
      setFile(tplFile);
      setName(tpl.name);
      setDescription(tpl.description);
      setTags(tpl.tags);
      setLicense(tpl.license);
      setStep("form");
    } catch {
      setError("Failed to load template. Please try again.");
    } finally {
      setLoadingTpl(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account)           { setError("Connect your wallet first."); return; }
    if (!file)              { setError("Select a dataset file."); return; }
    if (!name.trim())       { setError("Dataset name is required."); return; }
    if (!description.trim()){ setError("Description is required."); return; }
    if (tags.length === 0)  { setError("Select at least one tag."); return; }
    setError(null);

    const sellerAddress = account.address.toString();
    const priceOctas = !price || price === "0" ? 0 : Math.round(parseFloat(price) * 1e8);

    try {
      setStep("uploading");
      setStatusMsg("Uploading dataset to Shelby storage…");
      setStatusDetail("Server is encoding and registering your file on Shelby Testnet. This may take a moment.");

      const form = new FormData();
      form.append("file", file);
      form.append("sellerAddress", sellerAddress);

      const uploadRes = await fetch("/api/datasets/upload", { method: "POST", body: form });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }
      const { shelbyBlobName, commitmentBytes, blobSize } = await uploadRes.json();

      setStep("confirming");
      setStatusMsg("Sign marketplace registration in your wallet…");
      setStatusDetail("Recording dataset metadata and price on Aptos testnet.");

      const res = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::dataset_registry::register_dataset` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [name.trim(), description.trim(), shelbyBlobName, commitmentBytes, blobSize, priceOctas, tags, license],
        },
      });

      setTxHash(res.hash);
      setStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStep("form");
    }
  };

  const isProcessing = step === "uploading" || step === "confirming";

  // ── Done ────────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Header />
        <div style={{ maxWidth: "580px", margin: "8rem auto", padding: "0 2rem", textAlign: "center" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "var(--terra)", margin: "0 auto 2rem", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(192,57,10,0.3)" }}>
            <span style={{ color: "var(--parchment-card)", fontSize: "1.75rem", lineHeight: 1 }}>✦</span>
          </div>
          <div style={{ borderTop: "3px solid var(--ink)", borderBottom: "1px solid var(--ink)", height: "5px", marginBottom: "2rem" }} />
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "2.25rem", color: "var(--ink)", marginBottom: "0.875rem" }}>Specimen deposited</h1>
          <p style={{ fontFamily: "var(--font-body)", color: "var(--ink-light)", lineHeight: 1.7, marginBottom: "2rem" }}>
            <em>{name}</em> is now catalogued in the archive. Buyers may discover and acquire it using their Aptos wallet.
          </p>
          {txHash && (
            <div className="surface" style={{ padding: "0.875rem 1rem", marginBottom: "2rem", textAlign: "left" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--ink-faint)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>Transaction hash</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--accent-blue)", wordBreak: "break-all" }}>{txHash}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
            <button onClick={() => router.push("/")} style={{ padding: "0.7rem 1.5rem", background: "var(--ink)", color: "var(--parchment-card)", border: "none", borderRadius: "1px", fontFamily: "var(--font-mono)", fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
              View Archive →
            </button>
            <button onClick={resetForm} style={{ padding: "0.7rem 1.5rem", background: "transparent", color: "var(--ink)", border: "1px solid var(--stroke)", borderRadius: "1px", fontFamily: "var(--font-mono)", fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
              Deposit Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header />

      <div style={{ maxWidth: step === "templates" ? "1100px" : "760px", margin: "0 auto", padding: "3rem 2rem 6rem", transition: "max-width 0.2s ease" }}>

        {/* Page header */}
        <div style={{ marginBottom: "2.5rem" }}>
          <p style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1rem", color: "var(--ink-light)", marginBottom: "0.25rem" }}>
            Contribute to the archive
          </p>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(2rem, 4vw, 3rem)", color: "var(--ink)", lineHeight: 0.95 }}>
              Deposit a Dataset
            </h1>
            {/* Breadcrumb */}
            {(step === "templates" || step === "form") && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 600, color: "var(--ink-mid)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                <button onClick={resetForm} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit", letterSpacing: "inherit", textTransform: "inherit", padding: 0 }}>
                  Choose path
                </button>
                <span>/</span>
                {step === "form" ? (
                  <>
                    <button onClick={() => setStep("templates")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit", letterSpacing: "inherit", textTransform: "inherit", padding: 0 }}>
                      Templates
                    </button>
                    <span>/</span>
                    <span>Fill details</span>
                  </>
                ) : (
                  <span>Templates</span>
                )}
              </div>
            )}
          </div>
          <div style={{ borderTop: "3px solid var(--ink)", borderBottom: "1px solid var(--ink)", height: "5px", margin: "1.25rem 0" }} />
          {step === "path" && (
            <p style={{ fontFamily: "var(--font-body)", color: "var(--ink-light)", fontSize: "0.875rem", lineHeight: 1.65 }}>
              Your file is stored on Shelby's decentralised network using Clay Code erasure coding, then registered on Aptos. Buyers pay in APT — proceeds are yours immediately.
            </p>
          )}
        </div>

        {/* ── Step: Path selection ── */}
        {step === "path" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
            {/* Own upload */}
            <button
              onClick={() => setStep("form")}
              style={{ all: "unset", cursor: "pointer" }}
            >
              <div
                className="surface"
                style={{ padding: "2.5rem 2rem", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "1rem", transition: "border-color 0.15s ease, box-shadow 0.15s ease" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--ink)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 20px rgba(26,18,9,0.08)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
              >
                <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: "var(--ink)", lineHeight: 1 }}>↑</div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.375rem", color: "var(--ink)", marginBottom: "0.5rem" }}>
                    Upload your own dataset
                  </div>
                  <p style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "var(--ink-light)", lineHeight: 1.6, margin: 0 }}>
                    Start with a blank form. Upload any file format — CSV, JSONL, Parquet, ZIP, or custom. Set your own name, description, price, and tags.
                  </p>
                </div>
                <div style={{ marginTop: "auto", fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--terra)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Blank form →
                </div>
              </div>
            </button>

            {/* Template */}
            <button
              onClick={() => setStep("templates")}
              style={{ all: "unset", cursor: "pointer" }}
            >
              <div
                className="surface"
                style={{ padding: "2.5rem 2rem", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "1rem", transition: "border-color 0.15s ease, box-shadow 0.15s ease" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--terra)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 20px rgba(192,57,10,0.08)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
              >
                <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: "var(--terra)", lineHeight: 1 }}>⊞</div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.375rem", color: "var(--ink)", marginBottom: "0.5rem" }}>
                    Start from a template
                  </div>
                  <p style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "var(--ink-light)", lineHeight: 1.6, margin: 0 }}>
                    Choose from {TEMPLATES.length} curated dataset templates. Name, description, and a sample file are pre-loaded — edit freely before depositing.
                  </p>
                </div>
                <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {TEMPLATES.slice(0, 4).map((t) => (
                    <span key={t.id} style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", letterSpacing: "0.07em", textTransform: "uppercase", padding: "2px 7px", background: "var(--parchment-deep)", border: "1px solid var(--stroke)", borderRadius: "1px", color: "var(--ink-faint)" }}>
                      {t.format}
                    </span>
                  ))}
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", letterSpacing: "0.07em", textTransform: "uppercase", padding: "2px 7px", color: "var(--terra)" }}>
                    +{TEMPLATES.length - 4} more →
                  </span>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* ── Step: Template picker ── */}
        {step === "templates" && (
          <div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "var(--ink-light)", marginBottom: "1.75rem", fontStyle: "italic" }}>
              Select a template to pre-load the form. You can edit every field — name, description, file, price, and tags — before depositing.
            </p>

            {error && (
              <div style={{ padding: "0.75rem 1rem", marginBottom: "1.5rem", background: "rgba(192,57,10,0.08)", border: "1px solid rgba(192,57,10,0.25)", borderRadius: "1px", color: "var(--terra)", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
                {error}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
              {TEMPLATES.map((tpl) => {
                const loading = loadingTpl === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => selectTemplate(tpl)}
                    disabled={loadingTpl !== null}
                    style={{ all: "unset", cursor: loadingTpl ? "wait" : "pointer", display: "block" }}
                  >
                    <div
                      className="catalog-card"
                      style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem", height: "100%", boxSizing: "border-box", opacity: loadingTpl && !loading ? 0.5 : 1, transition: "opacity 0.15s ease, border-color 0.15s ease" }}
                      onMouseEnter={(e) => { if (!loadingTpl) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--terra)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = ""; }}
                    >
                      {/* Icon + format */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "1.5rem", color: "var(--terra)", lineHeight: 1 }}>{tpl.icon}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 8px", background: "var(--parchment-deep)", border: "1px solid var(--stroke)", borderRadius: "1px", color: "var(--ink-faint)" }}>
                          {tpl.format}
                        </span>
                      </div>

                      {/* Title + tagline */}
                      <div>
                        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.0625rem", color: "var(--ink)", marginBottom: "3px" }}>
                          {tpl.title}
                        </div>
                        <div style={{ fontFamily: "var(--font-body)", fontSize: "0.78rem", color: "var(--ink-faint)", fontStyle: "italic" }}>
                          {tpl.tagline}
                        </div>
                      </div>

                      {/* Description snippet */}
                      <p style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "var(--ink-light)", lineHeight: 1.55, margin: 0, flex: 1, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {tpl.description}
                      </p>

                      {/* Tags */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {tpl.tags.map((t) => (
                          <span key={t} style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", letterSpacing: "0.07em", textTransform: "uppercase", padding: "2px 7px", background: "rgba(192,57,10,0.08)", border: "1px solid rgba(192,57,10,0.2)", borderRadius: "1px", color: "var(--terra)" }}>
                            {t}
                          </span>
                        ))}
                      </div>

                      {/* CTA */}
                      <div style={{ borderTop: "1px solid var(--stroke-light)", paddingTop: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.62rem", letterSpacing: "0.1em", textTransform: "uppercase", color: loading ? "var(--terra)" : "var(--ink-faint)", display: "flex", alignItems: "center", gap: "6px" }}>
                        {loading
                          ? <><span style={{ display: "inline-block", animation: "spin 0.9s linear infinite" }}>◌</span>Loading…</>
                          : "Use this template →"
                        }
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Step: Form ── */}
        {(step === "form" || isProcessing) && (
          <>
            {/* Template notice */}
            {file && name && (
              <div style={{ padding: "0.625rem 1rem", marginBottom: "1.5rem", background: "rgba(37,98,58,0.06)", border: "1px solid rgba(37,98,58,0.2)", borderLeft: "3px solid var(--accent-green)", borderRadius: "1px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "var(--ink-light)", fontStyle: "italic" }}>
                  Template loaded — all fields are editable before depositing.
                </span>
              </div>
            )}

            {/* Progress indicator */}
            {isProcessing && (
              <div className="surface" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", border: "2px solid var(--stroke)", borderTopColor: "var(--terra)", flexShrink: 0, animation: "spin 0.85s linear infinite" }} />
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink)", marginBottom: "2px" }}>{statusMsg}</div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "var(--ink-light)", fontStyle: "italic" }}>{statusDetail}</div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ padding: "0.75rem 1rem", marginBottom: "1.5rem", background: "rgba(192,57,10,0.08)", border: "1px solid rgba(192,57,10,0.25)", borderRadius: "1px", color: "var(--terra)", fontFamily: "var(--font-body)", fontSize: "0.85rem", lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>

              {/* File drop zone */}
              <div>
                <FieldLabel>Dataset File</FieldLabel>
                <div
                  onClick={() => !isProcessing && fileRef.current?.click()}
                  onDrop={onDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  style={{
                    padding: "2.5rem",
                    border: dragOver ? "2px dashed var(--terra)" : file ? "1px solid var(--stroke)" : "2px dashed var(--stroke)",
                    background: dragOver ? "var(--terra-dim)" : file ? "var(--parchment-card)" : "transparent",
                    borderRadius: "2px", cursor: isProcessing ? "not-allowed" : "pointer",
                    textAlign: "center", transition: "all 0.15s ease",
                  }}
                >
                  <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} disabled={isProcessing} />
                  {file ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
                      <div>
                        <div style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "0.9rem", color: "var(--ink)", marginBottom: "2px" }}>{file.name}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--ink-faint)" }}>{fmt(file.size)}</div>
                      </div>
                      {!isProcessing && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); }} style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: "1.25rem", lineHeight: 1, padding: "2px" }}>×</button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.25rem", color: "var(--ink-light)", marginBottom: "0.375rem" }}>Drop specimen here</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--ink-faint)", letterSpacing: "0.08em" }}>or click to browse — any format</div>
                    </>
                  )}
                </div>
              </div>

              {/* Name */}
              <div>
                <FieldLabel>Dataset Name</FieldLabel>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GPT-4 Instruction Tuning Dataset" disabled={isProcessing} className="field-input" />
              </div>

              {/* Description */}
              <div>
                <FieldLabel>Description</FieldLabel>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the dataset contents, source, annotation quality, and intended use cases…" disabled={isProcessing} rows={5} className="field-input" />
              </div>

              {/* Price */}
              <div>
                <FieldLabel hint="— leave blank or 0 for free">Price (APT)</FieldLabel>
                <div style={{ position: "relative" }}>
                  <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" disabled={isProcessing} className="field-input" style={{ paddingRight: "2.5rem" }} />
                  <span style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--ink-faint)", pointerEvents: "none" }}>APT</span>
                </div>
              </div>

              {/* Tags */}
              <div>
                <FieldLabel hint="— select all that apply">Tags</FieldLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {TAGS.map((t) => {
                    const active = tags.includes(t);
                    return (
                      <button key={t} type="button" disabled={isProcessing} onClick={() => toggleTag(t)} style={{ padding: "0.3rem 0.875rem", border: active ? "1px solid var(--terra)" : "1px solid var(--stroke)", background: active ? "var(--terra-dim)" : "transparent", color: active ? "var(--terra)" : "var(--ink-light)", fontFamily: "var(--font-mono)", fontSize: "0.62rem", letterSpacing: "0.07em", textTransform: "uppercase", cursor: isProcessing ? "not-allowed" : "pointer", borderRadius: "1px", transition: "all 0.14s ease" }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* License */}
              <div>
                <FieldLabel>License</FieldLabel>
                <select value={license} onChange={(e) => setLicense(e.target.value)} disabled={isProcessing} className="field-input">
                  {LICENSES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>

              {/* Submit */}
              <div style={{ paddingTop: "0.5rem" }}>
                <button
                  type="submit"
                  disabled={isProcessing || !account}
                  style={{
                    width: "100%", padding: "1rem",
                    background: !account ? "transparent" : isProcessing ? "transparent" : "var(--ink)",
                    color: !account ? "var(--ink-faint)" : isProcessing ? "var(--ink-light)" : "var(--parchment-card)",
                    border: !account || isProcessing ? "1px solid var(--stroke)" : "none",
                    borderRadius: "1px", fontFamily: "var(--font-mono)", fontWeight: 500,
                    fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase",
                    cursor: isProcessing || !account ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    transition: "all 0.15s ease",
                  }}
                >
                  {!account
                    ? "Connect wallet to deposit"
                    : isProcessing
                      ? <><span style={{ display: "inline-block", animation: "spin 0.9s linear infinite" }}>◌</span>{statusMsg || "Processing…"}</>
                      : "Deposit Specimen to Archive"
                  }
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
