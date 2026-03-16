"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletSelector } from "@/components/WalletSelector";

const NAV = [
  { href: "/",          label: "Browse"  },
  { href: "/upload",    label: "Deposit" },
  { href: "/dashboard", label: "Ledger"  },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      backgroundColor: "var(--parchment)",
      borderBottom: "1px solid var(--stroke)",
    }}>
      {/* Terracotta top stripe */}
      <div style={{ height: "3px", background: "var(--terra)" }} />

      <div style={{
        maxWidth: "1280px", margin: "0 auto",
        padding: "0 2rem", height: "58px",
        display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: "2rem",
      }}>
        {/* Logo */}
        <Link href="/">
          <div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "1.5rem",
              letterSpacing: "0.12em",
              color: "var(--ink)",
              lineHeight: 1,
              textTransform: "uppercase",
            }}>
              DataVault
            </div>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem",
              letterSpacing: "0.16em",
              color: "var(--ink-light)",
              textTransform: "uppercase",
              marginTop: "2px",
            }}>
              AI Training Archive · Aptos
            </div>
          </div>
        </Link>

        {/* Nav */}
        <nav style={{ display: "flex", alignItems: "center" }}>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: active ? "var(--terra)" : "var(--ink-mid)",
                  padding: "0.5rem 1.25rem",
                  borderBottom: active ? "2px solid var(--terra)" : "2px solid transparent",
                  transition: "color 0.15s ease, border-color 0.15s ease",
                  display: "block",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLAnchorElement).style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLAnchorElement).style.color = "var(--ink-mid)";
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Wallet */}
        <div style={{ flexShrink: 0 }}>
          <WalletSelector />
        </div>
      </div>
    </header>
  );
}
