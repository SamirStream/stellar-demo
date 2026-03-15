# Frontend Architecture

## Overview

The frontend is a React 19 single-page application built with TypeScript 5.9, Vite 8, and Tailwind CSS v4. It provides a complete interface for interacting with the DealEscrow smart contract on Stellar Testnet — from the landing page through wallet connection, deal creation, milestone management, and reputation lookup.

**No backend required.** All interactions happen directly between the browser and Stellar's Soroban RPC via the `@stellar/stellar-sdk`.

## Component Architecture

```text
App.tsx (Root)
├── GlowingBackground          — Animated ambient background (fixed, z-0)
├── ToastContainer             — Global notification system
├── LiveTicker                 — Real-time on-chain marquee (homepage only)
├── Header
│   ├── SignalLogo             — logo.png, click-to-home when connected
│   ├── "THE SIGNAL" wordmark  — Space Grotesk 800, font-display class
│   └── ConnectWallet / Nav    — Wallet info + tab navigation when connected
├── LandingView (when disconnected)
│   ├── "Trust Engine." hero   — Glitch effect, always-on RGB aberration
│   ├── Connect Wallet CTA     — Opens Stellar Wallets Kit modal
│   └── Read the Docs CTA      — Links to GitHub repo
└── App Tabs (when connected)
    ├── Liquidity              — SoroswapWidget (Friendbot + XLM→USDC)
    ├── Deploy Contract        — CreateDeal (form + review + success)
    ├── Deals                  — DealDashboard (split-panel lifecycle)
    └── Oracle                 — ReputationBadge (on-chain reputation)
```

## Design System

### Tailwind CSS v4

Styling uses Tailwind v4 with custom properties defined in `src/index.css` via the `@theme` block (no `tailwind.config.js`):

```css
@theme {
  --animate-marquee: marquee 120s linear infinite;
  --animate-radar: radar 3s linear infinite;
  --animate-pulse-ring: pulse-ring 2s ease-in-out infinite;
  /* ... additional custom animations */
}
```

### Typography

| Usage | Font | Weight | Class |
|-------|------|--------|-------|
| "THE SIGNAL" header | Space Grotesk | 800 | `.font-display` |
| "Trust Engine." hero | Space Grotesk | 900 (font-black) | `font-black` |
| Code / addresses | JetBrains Mono | 400 | `font-mono` |
| Body | Inter | 400 | default |

Space Grotesk is loaded from Google Fonts with weights 700 and 800. JetBrains Mono and Inter are loaded via the same stylesheet.

### Glitch Effect

The "Trust Engine." heading uses a CSS-only RGB chromatic aberration effect defined in `@layer base`:

- **Always active** — `::before` (red layer) and `::after` (cyan layer) run two desynchronized keyframe animations (`glitch-1` at 4s, `glitch-2` at 3.5s)
- **Organic bursts** — Animations use `steps(1)` and have long quiet periods (85% of cycle is invisible) with sudden clip-path bursts
- **`mix-blend-mode: screen`** — Layers blend with white text for true chromatic aberration rather than plain text-shadow offsets
- **Hover pauses** — `::before` and `::after` set to `clip-path: inset(0 0 100% 0)` on hover, cleanly freezing the effect

### Shared UI Components

**`src/components/ui/Components.tsx`**

| Component | Props | Description |
|-----------|-------|-------------|
| `Card` | `className`, `hoverEffect`, `glowOnHover`, `onClick` | Dark bordered container with internal `relative z-10 h-full` wrapper. Apply flex/centering on inner content, not the Card itself. |
| `Button` | `variant`, `icon`, `disabled`, `onClick` | `primary` (emerald gradient) or `secondary` (zinc border). |
| `Tag` | `color` | Colored status badge: `emerald`, `amber`, `blue`, `red`, `zinc`. |

**`src/components/ui/Branding.tsx`**

| Component | Description |
|-----------|-------------|
| `SignalLogo` | Renders `public/logo.png` with configurable `className`. No glow effects. |
| `GlowingBackground` | Fixed full-screen layer: deep black base, architectural grid, emerald neon orbs, CRT scanline texture. |

### Live Network Ticker

**`App.tsx` — `LiveTicker` component**

A full-width marquee bar showing real on-chain deal data:

- **Read-only fetch on mount** — Calls `getDealCount()` and `getDeal()` via `useDealEscrow` without requiring wallet authentication (view functions are permissionless on Soroban)
- **Homepage only** — Hidden when `wallet.isConnected`. Disappears when the user connects and enters the app.
- **No fallback data** — If the chain is unreachable or there are no deals, the ticker is simply hidden
- **Data per deal**: Contract ID, status label (`ESCROW_ACTIVE`, `DEAL_COMPLETED`, etc.), total amount, plus per-milestone entries for funded/released milestones
- **Color coding**: Emerald = completed/released, Blue = active/funded, Amber = awaiting funding, Red = disputed
- **Scroll speed**: 120s per full cycle (very slow, cinematic)

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
- **Multi-wallet support**: Initializes Freighter, xBull, and Albedo modules. Users select via the Stellar Wallets Kit auth modal.
- **Auto-refresh balances**: Polls XLM and USDC balances every 15 seconds using ref-based intervals.
- **Error-categorized signing**: Catches wallet errors and provides user-friendly messages (cancelled, unavailable, or generic failure).
- **Event-driven state**: Listens to `STATE_UPDATED` and `DISCONNECT` events from the wallet kit.
- **Disconnect resets app**: `disconnect()` clears address + balances, returning the user to the landing page (logo click when connected also calls `disconnect()`).

### `useDealEscrow`

**File**: `src/hooks/useDealEscrow.ts`

All contract interaction methods with robust error handling and transaction lifecycle management.

```typescript
function useDealEscrow(walletAddress: string, signTransaction: Function) {
  return {
    createDeal,         // Create a new escrow deal
    deposit,            // Fund a specific milestone
    releaseMilestone,   // Execute atomic 3-way split
    dispute,            // Freeze a funded milestone
    resolveDispute,     // Admin: resolve with configurable refund %
    getDeal,            // Read deal state (simulation, no signing)
    getReputation,      // Read provider reputation (simulation, no signing)
    getDealCount,       // Read total deal count (simulation, no signing)
    contractId,         // Current contract address
  };
}
```

**Transaction pipeline** (`submitContractCall`):

```text
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
- **Transaction mutex**: `useRef` boolean prevents concurrent/double-click transactions
- **Confirmation timeout**: Hard limit of 30 retries (60 seconds)
- **Friendly error messages**: Soroban simulation errors translated to actionable messages
- **Deal ID extraction fallback**: Checks both `returnValue` and `resultMetaXdr.v3.sorobanMeta.returnValue`

## Components

### ConnectWallet

**File**: `src/components/ConnectWallet.tsx`

Wallet connection button displayed in the header when disconnected. Opens the Stellar Wallets Kit modal to select Freighter, xBull, or Albedo.

### SoroswapWidget

**File**: `src/components/SoroswapWidget.tsx`

Two-part funding interface (Liquidity tab):

**Section 1 — Friendbot**: One-click 10,000 XLM testnet funding with duplicate-funding detection.

**Section 2 — Soroswap DEX**: Quote → Sign → Swap for XLM→USDC via the Soroswap Aggregator API (multi-protocol routing: Soroswap, Phoenix, Aqua). 1% slippage tolerance.

### CreateDeal

**File**: `src/components/CreateDeal.tsx`

Three-step deal creation:

**Step 1 — Configuration**: Provider/Connector address inputs (real-time G-address validation), token selection, total amount, fee percentages, dynamic milestone editor (percentages must sum to 100%), live split preview.

**Step 2 — Review**: Full deal summary before signing. Transaction progress: Signing → Submitting → Confirming.

**Step 3 — Success**: Centered animated checkmark, Deal ID, transaction hash, Explorer link, "View Deal Dashboard" navigation.

**Quick Start scenarios**: Security Audit (500 XLM / 3 milestones), Dev Sprint (1,200 XLM / 2 milestones), Advisory Retainer (3,000 XLM / 4 milestones). Auto-fills demo testnet addresses.

### DealDashboard

**File**: `src/components/DealDashboard.tsx`

Split-panel deal lifecycle management:

**Left panel — Deal List**:
- Search bar with clear button (×), dynamic icon color, and result counter showing `N results for "query"`
- Segmented filter tabs (`All` / `In Progress` / `Awaiting Funding` / `Completed` / `Disputed` / `Cancelled`) — pill-track container with color-coded active states and status dots
- Per-deal cards: title, status tag, total amount, milestone progress, role badge (Client/Provider/Connector)
- Auto-refresh every 30 seconds via ref-based interval

**Right panel — Deal Detail**:
- Empty state: centered Activity icon + "Select a Contract" prompt (uses inner flex wrapper to bypass Card's internal wrapper)
- Deal header: status badge, escrow protection indicator, title, Deal ID copy, participant addresses with "YOU" badge, fee breakdown
- Milestone timeline: numbered nodes, color-coded status, context-aware action buttons
- 3-Way Split Visualization: animated bar chart after release, exact amounts + percentages per party
- Vault Analytics sidebar: Unlocked / Secured / Pending amounts
- Event Ledger sidebar: chronological milestone events with transaction trace links

**Confirmation modals**:
- Release: shows exact 3-way split before execution
- Dispute: freeze warning
- Resolve: interactive 0-100% slider with real-time client/provider preview
- All modals: ESC dismiss, backdrop click dismiss, scroll lock

### ReputationBadge

**File**: `src/components/ReputationBadge.tsx`

On-chain reputation lookup with radar animation and animated count-up display. Badge tiers: New Provider (0) → Verified (1+) → Trusted (5+) → Elite (10+).

## Library Modules

### stellar.ts

Core Stellar SDK configuration and utilities:

| Export | Description |
|--------|-------------|
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `XLM_SAC_ADDRESS` | Native XLM as Stellar Asset Contract |
| `DEAL_ESCROW_CONTRACT` | From `VITE_DEAL_ESCROW_CONTRACT` |
| `DEMO_ACCOUNTS` | Pre-generated provider/connector testnet addresses |
| `sorobanServer` | Soroban RPC Server instance |
| `horizonServer` | Horizon Server instance |
| `formatAmount()` | 7-decimal to human-readable |
| `toContractAmount()` | Human-readable to 7-decimal BigInt |
| `isValidStellarAddress()` | G-address regex validation |
| `truncateAddress()` | `GABCD...WXYZ` display format |

### soroswap.ts

Soroswap DEX Aggregator API client with `getQuote()`, `buildTransaction()`, `sendTransaction()` methods. API key via `VITE_SOROSWAP_API_KEY`.

### dealMetadata.ts

Local (localStorage) milestone naming and event log. Stores custom milestone names and records funded/released/disputed events per deal for the Event Ledger sidebar.

## UX Patterns

### Toast Notification System

React Context-based global toasts. Three types: `success`, `error`, `info`. Auto-dismiss after 3s, click to dismiss. Max 3 concurrent. Accessible via `aria-live="polite"`.

### Transaction Progress

```text
[Signing] → [Submitting] → [Confirming]
```

Step indicator during the ~5-10 second confirmation window.

### Keyboard Navigation

| Shortcut | Action |
|----------|--------|
| `Alt+1` | Liquidity tab |
| `Alt+2` | Deploy Contract tab |
| `Alt+3` | Deals tab |
| `Alt+4` | Oracle tab |
| `Escape` | Close confirmation modals |

Only active when wallet is connected.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_DEAL_ESCROW_CONTRACT` | Yes | Deployed DealEscrow contract address |
| `VITE_USDC_TOKEN_ADDRESS` | No | Testnet USDC SAC address |
| `VITE_SOROSWAP_API_KEY` | No | Soroswap Aggregator API key |

## Build and Development

```bash
cd frontend
npm install
npm run dev      # Development server on :5173
npm run build    # TypeScript check + Vite production build
npm run preview  # Preview production build
```

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.x | UI framework |
| `@stellar/stellar-sdk` | 14.6.1 | Stellar/Soroban interaction |
| `@creit.tech/stellar-wallets-kit` | 2.0.1 | Multi-wallet connection |
| `lucide-react` | 0.577+ | Icon library |
| `tailwindcss` | 4.2.x | Utility-first CSS (v4) |
| `typescript` | 5.9 | Type safety |
| `vite` | 8.0 | Build tool |
