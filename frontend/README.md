# The Signal — Stellar Escrow Demo

Decentralized escrow frontend on **Stellar Soroban Testnet**.
Milestone-based contracts, atomic fee routing, on-chain reputation, embedded wallets.

---

## Stack

| Layer | Technology |
| --- | --- |
| UI | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 (`@theme` block) |
| Chain | Stellar / Soroban Testnet |
| Stellar SDK | `@stellar/stellar-sdk` |
| Extension wallets | `@creit.tech/stellar-wallets-kit` — Freighter, Albedo |
| Embedded wallets | `@privy-io/react-auth` — Email OTP, Google, Twitter, Discord |

---

## Quick Start

```bash
cd frontend
npm install
cp .env.example .env   # fill in VITE_PRIVY_APP_ID (see below)
npm run dev            # http://localhost:5173
```

---

## Environment Variables

Create a `.env` file at the root of the `frontend/` folder:

```env
# Required for email/social login (embedded wallets)
VITE_PRIVY_APP_ID=your-privy-app-id-here

# Set after deploying the contract to Testnet
VITE_DEAL_ESCROW_CONTRACT=

# Testnet USDC token address (SAC)
VITE_USDC_TOKEN_ADDRESS=
```

> Without `VITE_PRIVY_APP_ID`, the **Email / Social** tab shows a warning but the
> **Freighter / Albedo** path remains fully functional.

---

## Wallet Architecture

```text
Connect Wallet
├── Tab "Email / Social"  →  Direct OAuth / OTP (no iframe, no popup blocks)
│     ├── Google / Twitter / Discord  →  useLoginWithOAuth → initOAuth()
│     └── Email OTP                  →  useLoginWithEmail → sendCode / loginWithCode
│           └── useCreateWallet({ chainType: 'stellar' })
│                 └── Stellar Ed25519 embedded wallet
│                       └── signing: getStellarTxHash → signRawHash → assembleStellarSignedTx
│
└── Tab "Extension Wallet"  →  StellarWalletsKit modal
      ├── Freighter (Chrome / Firefox extension)
      └── Albedo   (web-based, no extension needed)
```

Both paths expose the same `WalletState` interface via `useUnifiedWallet`.
All components (`DealDashboard`, `CreateDeal`, etc.) are wallet-source agnostic.

**Key implementation note:** OAuth buttons call `initOAuth()` directly from the main
window context (not from inside Privy's iframe) — required for popup-based OAuth to
work in Firefox and Chrome without being silently blocked.

---

## Dispute Resolution

Disputes follow a two-phase model:

| Actor | Action |
| --- | --- |
| Client or Provider | Flag dispute → milestone frozen |
| Client (optional) | Accept & Release to Provider (override the dispute) |
| **The Signal team** (arbiter) | Call `resolve_dispute` on-chain with refund split |

The arbiter address is set at deal creation. Only that address can call `resolve_dispute`.
The client UI surfaces an "Under review" banner and an optional release override — it does
**not** expose the arbiter's split controls.

---

## Features

- **Deal Terminal** — browse all on-chain escrows, filter by status, search by ID / address
- **New Contract** — create milestone-based escrow deals with custom splits
- **Fund** — deposit XLM into milestone vaults via Soroswap widget
- **Oracle** — scan any public key's on-chain reputation + on-chain leaderboard (top clients / providers)
- **Live Ticker** — real-time feed of recent contract activity on the homepage

---

## Key Files

```text
frontend/src/
├── hooks/
│   ├── useStellarWallet.ts    # Freighter / Albedo via StellarWalletsKit
│   ├── usePrivyWallet.ts      # Email / Social via Privy (isWalletLoading state)
│   ├── useUnifiedWallet.ts    # Merges both sources → single WalletState
│   └── useDealEscrow.ts       # Soroban contract calls
├── lib/
│   ├── stellar.ts             # RPC URLs, Stellar SDK helpers
│   ├── privy-stellar.ts       # Signing bridge: XDR ↔ Privy raw hash
│   └── dealMetadata.ts        # Local event log
├── components/
│   ├── WalletConnectModal.tsx # 2-tab modal (Privy + SWK)
│   ├── DealDashboard.tsx      # Split-panel deal management UI
│   ├── ReputationBadge.tsx    # Oracle scanner + leaderboard
│   └── ui/Components.tsx      # Card, Button, Tag primitives
└── App.tsx                    # Root — LiveTicker, tab navigation, wallet loading skeleton
```

---

## Setting Up Privy (Embedded Wallets)

Privy lets users connect **without a browser extension** via email or social account.
A self-custodial Stellar Ed25519 wallet is created client-side on first login.

### 1. Create a Privy account

1. Go to **[https://privy.io](https://privy.io)** → **Start for free**
2. Sign up with GitHub or email

### 2. Create an app

1. Dashboard → **Create app**
2. Name: `The Signal` (or anything)
3. Type: **Web**

### 3. Get the App ID

1. Dashboard → your app → **Settings** → **Basics**
2. Copy the **App ID** field (`clz-xxxxxxxxxxxxxxxxxx`)
3. Paste into `.env`:

   ```env
   VITE_PRIVY_APP_ID=clz-xxxxxxxxxxxxxxxxxx
   ```

### 4. Enable login methods

Dashboard → **Login methods**, enable:

- Email (OTP)
- Google *(requires OAuth credentials in dashboard)*
- Twitter / X *(requires OAuth credentials)*
- Discord *(requires OAuth credentials)*

> Methods not enabled in the dashboard will be silently unavailable.
> If OAuth buttons do nothing, check that the provider is enabled and its
> Client ID / Secret are configured.

### 5. Set allowed origins

Dashboard → **Settings** → **Allowed origins** → add:

- `http://localhost:5173` (dev)
- your production domain if deployed

---

## Commands

```bash
npm run dev      # Dev server (http://localhost:5173)
npm run build    # Production build
npm run preview  # Preview the build
npx tsc --noEmit # Type-check without emitting
```

---

## Resources

- [Stellar Soroban Docs](https://soroban.stellar.org)
- [Privy Docs — Stellar (Tier 2)](https://docs.privy.io/wallets/using-wallets/other-chains)
- [StellarWalletsKit](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
- [Stellar Expert (Testnet Explorer)](https://stellar.expert/explorer/testnet)
