# Frontend Architecture

## Overview

The frontend is a React 19 single-page application built with TypeScript 5.9 and Vite 8. It provides a complete interface for interacting with the DealEscrow smart contract on Stellar Testnet — from wallet connection through deal creation, milestone management, and reputation lookup.

**No backend required.** All interactions happen directly between the browser and Stellar's Soroban RPC via the `@stellar/stellar-sdk`.

## Component Architecture

```
App.tsx (Root)
├── ToastContainer         — Global notification system
├── Header
│   ├── Logo
│   ├── Testnet Badge
│   └── ConnectWallet      — Multi-wallet connection UI
├── Tab Navigation         — Step-based flow (Fund → Create → Dashboard → Reputation)
├── Tab Content
│   ├── SoroswapWidget     — Friendbot funding + XLM→USDC swap
│   ├── CreateDeal         — Deal creation form with review step
│   ├── DealDashboard      — Full deal lifecycle management
│   └── ReputationBadge    — On-chain reputation lookup
└── Footer                 — Explorer links
```

## Custom Hooks

### `useStellarWallet`

**File**: `src/hooks/useStellarWallet.ts`

Manages wallet connection, balance tracking, and transaction signing via Stellar Wallets Kit.

```typescript
interface WalletState {
  address: string;
  isConnected: boolean;
  xlmBalance: string;
  usdcBalance: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  signTransaction: (xdr: string, opts?: any) => Promise<string>;
}
```

**Key features**:
- **Multi-wallet support**: Initializes Freighter, xBull, and Albedo modules. Users select their wallet via the Stellar Wallets Kit auth modal.
- **Auto-refresh balances**: Polls XLM and USDC balances every 15 seconds using ref-based intervals to avoid stale closures and unnecessary interval restarts.
- **Error-categorized signing**: The `signTransaction` wrapper catches wallet errors and provides user-friendly messages:
  - User rejection (cancel/reject/denied) → "Transaction cancelled by user."
  - Wallet unavailable → "Wallet not available. Please reconnect."
  - Other errors → "Signing failed: {message}"
- **Event-driven state**: Listens to `STATE_UPDATED` and `DISCONNECT` events from the wallet kit for reactive UI updates.

### `useDealEscrow`

**File**: `src/hooks/useDealEscrow.ts`

Provides all contract interaction methods with robust error handling and transaction lifecycle management.

```typescript
function useDealEscrow(walletAddress: string, signTransaction: Function) {
  return {
    createDeal,         // Create a new escrow deal
    deposit,            // Fund a specific milestone
    releaseMilestone,   // Execute atomic 3-way split
    dispute,            // Freeze a funded milestone
    resolveDispute,     // Admin: resolve with configurable refund %
    getDeal,            // Read deal state (simulation only, no signing)
    getReputation,      // Read provider reputation (simulation only)
    contractId,         // Current contract address
  };
}
```

**Transaction pipeline** (`submitContractCall`):

```
1. Build Transaction
   └── TransactionBuilder with 1 XLM max fee, 120s timeout

2. Simulate
   └── sorobanServer.simulateTransaction()
   └── Parse errors via friendlyError() helper

3. Assemble
   └── rpc.assembleTransaction() attaches footprint + auth

4. Sign
   └── Wallet signs via signTransaction()

5. Submit
   └── sorobanServer.sendTransaction()

6. Poll for Confirmation
   └── Max 30 retries × 2s = 60s timeout
   └── Throws on timeout or on-chain failure
```

**Safety mechanisms**:
- **Transaction mutex**: A `useRef` boolean prevents concurrent transactions. Rapid double-clicks on action buttons will not fire duplicate transactions.
- **Confirmation timeout**: The polling loop has a hard limit of 30 retries (60 seconds). If confirmation doesn't arrive, the user is directed to check Stellar Explorer rather than hanging indefinitely.
- **Friendly error messages**: Soroban simulation errors are parsed and translated from raw JSON into actionable messages (e.g., "Insufficient balance", "Transaction too expensive", "This action was already performed").
- **Deal ID extraction fallback**: After `create_deal`, the hook checks both `returnValue` and `resultMetaXdr.v3.sorobanMeta.returnValue` to extract the deal ID. If extraction fails on a successful transaction, it throws with the transaction hash for manual verification.

**Read-only operations** (`getDeal`, `getReputation`):
- Use transaction simulation only — no signing or submission required
- Lower fees (100 stroops) and shorter timeouts (30s)
- Gracefully return `null` or `0` on failure

## Components

### ConnectWallet

**File**: `src/components/ConnectWallet.tsx`

Minimal wallet connection UI displayed in the header. Shows:
- "Connect Wallet" button when disconnected
- Truncated address with green status dot when connected
- Formatted XLM balance (with thousands separators: "10,000.00 XLM")
- USDC balance when non-zero
- Disconnect button

### SoroswapWidget

**File**: `src/components/SoroswapWidget.tsx`

Two-part funding interface:

**Section 1 — Friendbot Funding**:
- One-click testnet XLM funding (10,000 XLM)
- Detects "already funded" responses and shows an informational message instead of an error
- Triggers balance refresh in the header after funding
- Provides "Next: Create a Deal" navigation button on success

**Section 2 — Soroswap DEX Integration**:
- Quote → Sign → Swap workflow for XLM→USDC conversion
- Powered by the Soroswap Aggregator API (multi-protocol routing: Soroswap, Phoenix, Aqua)
- Shows exchange rate and slippage tolerance (1%)
- Graceful degradation: warns users that testnet liquidity may be limited and suggests using XLM directly

**Balance display**: Shows current XLM balance at the top of the tab so users can assess whether they need to fund.

### CreateDeal

**File**: `src/components/CreateDeal.tsx`

Multi-step deal creation form:

**Step 1 — Configuration**:
- Provider and Connector address inputs with real-time Stellar address validation (G... format, 56 characters)
- Payment token selection (XLM or USDC)
- Total amount input
- Platform fee percentage (1-50%)
- Connector share percentage (0-100% of platform fee)
- Dynamic milestone editor (add/remove milestones, percentages must sum to 100%)
- Live split preview showing Provider/Connector/Protocol percentages

**Step 2 — Review**:
- Summary of all deal parameters before signing
- Milestone amounts calculated from percentages
- Split preview with exact amounts per party
- Transaction progress indicator (Signing → Submitting → Confirming)

**Step 3 — Confirmation**:
- Animated success checkmark
- Deal ID and transaction hash with Explorer link
- "View Deal Dashboard" button (auto-navigates to dashboard with the new deal loaded)

**Quick Start scenarios**: Three pre-configured demo scenarios (Security Audit, Dev Sprint, Advisory Retainer) that populate the form with realistic parameters for quick testing.

**Validations**:
- Stellar address format validation
- All milestone percentages must be > 0%
- Milestone percentages must sum to exactly 100%
- Total amount must be > 0
- Token address must be configured

### DealDashboard

**File**: `src/components/DealDashboard.tsx`

Full deal lifecycle management with real-time updates:

**Deal Loading**:
- Manual deal ID input with "Load Deal" button (no auto-fetch on keystroke to avoid unnecessary API calls)
- Auto-loads when navigated from Create Deal with a new deal ID
- Loading skeleton animation during fetch
- Empty state with "Create a Deal" CTA button

**Deal Overview**:
- Color-coded status badge (Awaiting Funding / In Progress / Completed / Disputed / Cancelled)
- Total amount display with token symbol
- Escrow protection indicator (shield icon) for active deals
- "Updated Xs ago" timestamp indicator
- Participant addresses with copy-to-clipboard functionality
- "You" badge next to the connected wallet's role
- Platform fee and connector share percentages

**Milestone Timeline**:
- Visual timeline with numbered nodes and connecting lines
- Color-coded milestone status badges
- Context-aware action buttons based on role and milestone state:
  - **Client + Pending**: "Fund" button (with balance check)
  - **Client + Funded**: "Approve & Release" and "Dispute" buttons
  - **Provider + Funded**: "Dispute" button
  - **Disputed**: "Resolve" button (admin)
  - **Released**: Green checkmark "Paid" indicator

**3-Way Split Visualization**:
- After releasing a milestone, displays an animated bar chart showing the Provider/Connector/Protocol split
- Shows exact amounts and percentages for each party
- Links to Stellar Explorer to verify the atomic transaction

**Confirmation Modals**:
- **Release confirmation**: Shows the exact 3-way split amounts before execution. "This action is irreversible."
- **Dispute confirmation**: Explains that disputed milestones are frozen until admin resolution
- **Resolve dispute**: Interactive slider (0-100%) to set client refund percentage, with real-time preview of client refund and provider payout amounts
- All modals support ESC key dismiss, backdrop click dismiss, and scroll locking

**Balance Protection**: Before depositing, checks the connected wallet's XLM balance against the milestone amount. Shows "Insufficient balance" error with a "Fund Wallet" navigation button.

**Auto-refresh**: Polls the contract every 15 seconds when a deal is loaded, using ref-based intervals for stable polling.

### ReputationBadge

**File**: `src/components/ReputationBadge.tsx`

On-chain reputation lookup with visual feedback:

- Address input pre-filled with connected wallet
- "Use My Address" quick-fill button
- Animated count-up display (easeOutCubic easing)
- Tiered badge system:
  - 0 deals: "New Provider"
  - 1+ deals: "Verified Provider"
  - 5+ deals: "Trusted Provider"
  - 10+ deals: "Elite Provider"
- Loading skeleton during lookup
- Link to contract on Stellar Explorer

## Library Modules

### stellar.ts

**File**: `src/lib/stellar.ts`

Core Stellar SDK configuration and utility functions:

| Export | Type | Description |
|--------|------|-------------|
| `NETWORK_PASSPHRASE` | const | Stellar Testnet passphrase |
| `SOROBAN_RPC_URL` | const | `https://soroban-testnet.stellar.org` |
| `XLM_SAC_ADDRESS` | const | Native XLM wrapped as Stellar Asset Contract |
| `USDC_TOKEN_ADDRESS` | const | From `VITE_USDC_TOKEN_ADDRESS` env var |
| `DEAL_ESCROW_CONTRACT` | const | From `VITE_DEAL_ESCROW_CONTRACT` env var |
| `DEMO_ACCOUNTS` | object | Pre-generated testnet provider and connector addresses |
| `sorobanServer` | instance | Soroban RPC Server connection |
| `horizonServer` | instance | Horizon Server connection |
| `fundTestnetAccount()` | function | Friendbot XLM funding |
| `getXlmBalance()` | function | Native XLM balance via Horizon |
| `getTokenBalance()` | function | SAC token balance via Soroban simulation |
| `formatAmount()` | function | 7-decimal to human-readable conversion |
| `toContractAmount()` | function | Human-readable to 7-decimal BigInt conversion |
| `isValidStellarAddress()` | function | G-address format validation (regex) |
| `truncateAddress()` | function | `GABCD...WXYZ` display format |

### soroswap.ts

**File**: `src/lib/soroswap.ts`

Soroswap DEX Aggregator API client:

```typescript
class SoroswapClient {
  getQuote(assetIn, assetOut, amount)    // Step 1: Get swap quote
  buildTransaction(quote, fromAddress)    // Step 2: Build signable XDR
  sendTransaction(signedXdr)              // Step 3: Submit signed swap
}
```

- Routes through multiple DEX protocols: Soroswap, Phoenix, Aqua
- 1% default slippage tolerance
- API key authentication via `VITE_SOROSWAP_API_KEY` env var

## UX Patterns

### Toast Notification System

Global toast system via React Context:

- Three types: `success` (green), `error` (red), `info` (blue)
- Auto-dismiss after 3 seconds with exit animation
- Click to dismiss immediately
- Maximum 3 concurrent toasts (oldest are removed when limit is exceeded)
- Accessible via `aria-live="polite"` region

### Transaction Progress Tracking

Multi-step progress indicator shown during contract interactions:

```
[Signing] → [Submitting] → [Confirming]
```

Each step lights up as the transaction progresses through the pipeline. Gives users confidence that the app is working during the ~5-10 second confirmation wait.

### Loading Skeletons

Shimmer-animated placeholder UI shown while data loads:
- Deal dashboard: circle + line skeletons mimicking deal layout
- Reputation badge: centered circle + line skeletons

### Keyboard Navigation

- **Alt+1/2/3/4**: Quick tab switching (Fund/Create/Dashboard/Reputation)
- **Escape**: Dismiss confirmation modals
- Only active when wallet is connected

### Scroll-Reactive Header

Header applies a subtle visual change (blur/shadow) when the page is scrolled, providing depth without distraction.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_DEAL_ESCROW_CONTRACT` | Yes | Deployed DealEscrow contract address |
| `VITE_USDC_TOKEN_ADDRESS` | No | Testnet USDC SAC address (for swap feature) |
| `VITE_SOROSWAP_API_KEY` | No | Soroswap Aggregator API key (for swap feature) |

## Build and Development

```bash
cd frontend
npm install
npm run dev      # Development server on :5173
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.x | UI framework |
| `@stellar/stellar-sdk` | 14.6.1 | Stellar/Soroban interaction |
| `@creit.tech/stellar-wallets-kit` | 2.0.1 | Multi-wallet connection |
| `typescript` | 5.9 | Type safety |
| `vite` | 8.0 | Build tool |

Zero additional UI dependencies — all styling is custom CSS, all icons are inline SVG.
