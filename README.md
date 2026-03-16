# AI Dataset Marketplace

A decentralized marketplace for AI training datasets built on **Aptos** (smart contracts) and **Shelby** (decentralized blob storage).

## Overview

- **Sellers** upload datasets to Shelby, register metadata + price on-chain via Move contracts
- **Buyers** pay in APT, receive a `PurchaseReceipt` on-chain, then download via Shelby
- **Integrity** is guaranteed by Shelby's cryptographic blob commitments (Clay Codes erasure coding, 10+6 chunks) — no trusted third party

## Tech Stack

| Layer | Technology |
|---|---|
| Storage | Shelby (decentralized blob storage, Shelbynet) |
| Smart Contracts | Aptos Move (DatasetRegistry + Marketplace modules) |
| Frontend | Next.js + Aptos Wallet Adapter + shadcn/ui + Tailwind |
| Blockchain SDK | `@aptos-labs/ts-sdk` |
| Storage SDK | `@shelby-protocol/sdk` |

## Deployment

| Field | Value |
|---|---|
| Network | Aptos Testnet (staging) |
| Module address | `0x615218f85ebb9f7fbe085d34cf2dfc14beb21b33b7df0d048f556de00a6f4b50` |
| Deploy tx | `0xf194495b20ebc8a53c3c44f38a07f1f8e26fd3cc9616a2e23aa35edb67c742d7` |
| Node URL | `https://api.testnet.staging.aptoslabs.com/v1` |

## Project Structure

```
marketplace/
├── contract/
│   ├── sources/
│   │   ├── dataset_registry.move   # Dataset metadata + ownership
│   │   └── marketplace.move        # Purchase, access control, earnings
│   └── tests/
│       └── test_end_to_end.move    # 29 tests, all passing
├── frontend/
│   ├── src/app/
│   │   ├── page.tsx                # Browse — dataset grid + search
│   │   ├── datasets/[id]/          # Dataset detail + purchase/download
│   │   ├── upload/                 # Seller upload flow
│   │   └── dashboard/              # Seller/buyer dashboard
│   └── src/app/api/
│       ├── datasets/upload/        # POST — Shelby upload + on-chain register
│       └── datasets/[id]/download/ # GET — access-gated Shelby download
└── README.md
```

## Move Commands

```bash
npm run move:compile   # Compile contracts
npm run move:test      # Run test suite (29 tests)
npm run move:publish   # Deploy to configured network
npm run move:upgrade   # Upgrade deployed contract
```

## Development

```bash
npm install
npm run dev            # Start frontend at localhost:3000
npm run build          # Production build
```

Environment variables (`.env.local`):
```
NEXT_PUBLIC_MODULE_ADDRESS=0x6152...
NEXT_PUBLIC_APTOS_NODE_URL=https://api.testnet.staging.aptoslabs.com/v1
SHELBY_API_KEY=<from geomi.dev>
```

## Security

- CEI (checks-effects-interactions) pattern on all state-changing functions
- u128 intermediate arithmetic prevents fee overflow on large prices
- `MAX_PRICE_OCTAS = 100_000_000_000_000` (1M APT) enforced at registration and update
- Download API verifies `has_access(buyer, dataset)` on-chain before streaming

See `SECURITY_AUDIT.md` for the full audit report.
