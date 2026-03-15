# The Signal — Stellar Escrow Demo

Milestone-based escrow with atomic 3-way payment splits on Soroban. Built for the [Stellar Community Fund (SCF) Integration Track](https://communityfund.stellar.org/).

## What This Is

This is a fully functional implementation of The Signal's deal escrow system on Stellar's Soroban smart contract platform. It demonstrates how a real-world B2B marketplace handles milestone-based payments with three-party atomic splits — the exact logic running in production at [thesignal.directory](https://thesignal.directory).

**Contract on Testnet**: [`CASW4L3WIFJDL2ZOBKBEMO6GV5O34DRBURRUF2EPRFFIQLJHZMSUK7IC`](https://stellar.expert/explorer/testnet/contract/CASW4L3WIFJDL2ZOBKBEMO6GV5O34DRBURRUF2EPRFFIQLJHZMSUK7IC)

## Key Features

- **Milestone-Based Escrow** — Deals are broken into milestones (e.g., 30/50/20). Each milestone is funded independently and released only when the client approves.
- **Atomic 3-Way Splits** — Every milestone release executes three transfers in a single atomic transaction: Provider (service delivery), Connector (business development referral), and Protocol (platform fee).
- **On-Chain Reputation** — Providers accumulate a verifiable deal completion counter stored permanently on-chain. Cannot be faked or altered.
- **Dispute Resolution** — Either party can raise a dispute to freeze funds. An admin resolves disputes with a configurable refund percentage (0-100%).
- **Soroswap DEX Integration** — Swap XLM to USDC directly in the app via the Soroswap aggregator API.
- **Multi-Wallet Support** — Connect with Freighter, xBull, or Albedo via Stellar Wallets Kit.

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                    Frontend                       │
│  React 19 + TypeScript + Vite                     │
│                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Connect  │ │ Create   │ │  Deal Dashboard   │  │
│  │ Wallet   │ │ Deal     │ │  (Fund/Release/   │  │
│  │          │ │          │ │   Dispute)         │  │
│  └────┬─────┘ └────┬─────┘ └────────┬──────────┘  │
│       │             │                │             │
│  ┌────┴─────────────┴────────────────┴──────────┐  │
│  │        useDealEscrow Hook                     │  │
│  │  (Build TX → Simulate → Sign → Submit → Poll)│  │
│  └──────────────────┬────────────────────────────┘  │
└─────────────────────┼────────────────────────────────┘
                      │ Soroban RPC
┌─────────────────────┼────────────────────────────────┐
│              Stellar Testnet                          │
│  ┌──────────────────┴────────────────────────────┐   │
│  │         DealEscrow Smart Contract              │   │
│  │                                                │   │
│  │  create_deal() → deposit() → release_milestone()│  │
│  │                    ↓                            │  │
│  │            Atomic 3-Way Split                   │  │
│  │     ┌──────────┬──────────┬──────────┐         │  │
│  │     │ Provider │Connector │ Protocol │         │  │
│  │     │  (90%)   │  (4%)    │  (6%)    │         │  │
│  │     └──────────┴──────────┴──────────┘         │  │
│  └────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) with `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
- Node.js 18+
- A Stellar wallet extension ([Freighter](https://freighter.app/), xBull, or Albedo)

### 1. Build the Smart Contract

```bash
# Build and optimize the contract
stellar contract build
stellar contract optimize --wasm target/wasm32v1-none/release/deal_escrow.wasm

# Run tests (10 test cases)
cargo test
```

### 2. Deploy to Testnet

```bash
# Generate a deployer account
stellar keys generate deployer --network testnet --fund

# Deploy the contract
stellar contract deploy \
  --wasm target/wasm32v1-none/release/deal_escrow.wasm \
  --source-account deployer \
  --network testnet \
  --alias deal_escrow

# Initialize with admin + protocol wallet
stellar contract invoke --id deal_escrow --source-account deployer --network testnet \
  -- initialize \
  --admin deployer \
  --protocol_wallet deployer
```

### 3. Run the Frontend

```bash
cd frontend
npm install

# Set your contract address
cp .env.example .env
# Edit .env with your deployed contract address

npm run dev
```

### 4. Try It

1. Open http://localhost:5173
2. Connect your Stellar wallet (switch to Testnet)
3. Fund your wallet with 10,000 XLM via Friendbot
4. Create a deal with demo scenarios
5. Fund milestones, release them, and watch the 3-way split
6. Check the provider's on-chain reputation

## Project Structure

```
stellar-demo/
├── contracts/
│   └── deal_escrow/
│       └── src/
│           ├── lib.rs              # Smart contract (525 lines, 9 functions)
│           └── test.rs             # Test suite (385 lines, 10 tests)
├── frontend/
│   └── src/
│       ├── App.tsx                 # Main app with toast system + tab navigation
│       ├── hooks/
│       │   ├── useStellarWallet.ts # Wallet connection + balance management
│       │   └── useDealEscrow.ts    # Contract interaction layer
│       ├── lib/
│       │   ├── stellar.ts          # Stellar SDK configuration + helpers
│       │   └── soroswap.ts         # Soroswap DEX API client
│       └── components/
│           ├── ConnectWallet.tsx    # Multi-wallet connect UI
│           ├── CreateDeal.tsx       # Deal creation with review step
│           ├── DealDashboard.tsx    # Full deal lifecycle management
│           ├── SoroswapWidget.tsx   # Friendbot + swap interface
│           └── ReputationBadge.tsx  # On-chain reputation display
└── docs/
    ├── ARCHITECTURE.md             # System design + integration patterns
    ├── SMART_CONTRACT.md           # Contract API reference
    ├── FRONTEND.md                 # Frontend architecture details
    └── DEMO_GUIDE.md              # Step-by-step demo walkthrough
```

## Smart Contract API

| Function | Auth | Description |
|----------|------|-------------|
| `initialize(admin, protocol_wallet)` | Deployer | One-time setup |
| `create_deal(client, provider, connector, token, fee_bps, share_bps, milestones)` | Client | Create escrow deal with milestones |
| `deposit(deal_id, milestone_idx)` | Client | Fund a milestone |
| `release_milestone(deal_id, milestone_idx)` | Client | Execute atomic 3-way split |
| `dispute(caller, deal_id, milestone_idx)` | Client/Provider | Freeze disputed milestone |
| `resolve_dispute(deal_id, milestone_idx, refund_bps)` | Admin | Split disputed funds |
| `refund(deal_id)` | Admin | Full refund of all funded milestones |
| `get_deal(deal_id)` | Anyone | Read deal state |
| `get_reputation(provider)` | Anyone | Read provider's completed deal count |

## Split Math

The split logic mirrors The Signal's production `approveMilestone()`:

```
Example: $10,000 milestone, 10% platform fee, 40% connector share

platform_fee    = $10,000 x 10%  = $1,000
connector_cut   = $1,000  x 40%  = $400
protocol_cut    = $1,000  - $400  = $600
provider_cut    = $10,000 - $1,000 = $9,000

Result: 3 atomic transfers in a single transaction
  → Provider:  $9,000 (90%)
  → Connector: $400   (4%)
  → Protocol:  $600   (6%)
```

## Test Suite

10 comprehensive tests covering all contract paths:

| # | Test | Verifies |
|---|------|----------|
| 1 | Happy path (single milestone) | Create → Fund → Release → verify split amounts |
| 2 | Multi-milestone (30/50/20) | 3 milestones sequentially funded + released |
| 3 | Reputation counter | Increments after each completed deal |
| 4 | Dispute + resolve | Freeze funds → admin resolves with 50/50 split |
| 5 | Full refund | Admin refunds all funded milestones to client |
| 6 | Auth checks | Non-client cannot deposit (panics) |
| 7 | Double deposit prevention | Cannot fund same milestone twice |
| 8 | Release unfunded fails | Cannot release a Pending milestone |
| 9 | Deal count tracking | Counter increments correctly |
| 10 | Variable commission (65%) | Architect tier connector share |

```bash
cargo test
# running 10 tests ... test result: ok. 10 passed; 0 failed
```

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Smart Contract | Rust + Soroban SDK | 22.0.0 |
| Frontend | React + TypeScript | 19.x + 5.9 |
| Build Tool | Vite | 8.0 |
| Stellar SDK | @stellar/stellar-sdk | 14.6.1 |
| Wallet Kit | @creit.tech/stellar-wallets-kit | 2.0.1 |
| DEX | Soroswap Aggregator API | Testnet |
| Network | Stellar Testnet | Soroban RPC |

## Production Parity

This demo replicates the exact business logic from The Signal's production escrow system:

| Feature | Production (The Signal) | This Demo (Soroban) |
|---------|------------------------|---------------------|
| 3-party split | `approveMilestone()` in Node.js | `release_milestone()` in Rust |
| Milestone lifecycle | Pending → Funded → Released | Same states, on-chain |
| BD connector tiers | 40-65% of platform fee | Parameterized per deal |
| Dispute escalation | Admin dashboard + Stripe | Smart contract + admin auth |
| Reputation | Database counter | Persistent storage on-chain |
| Payment | Stripe Connect | SAC token transfers |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design, integration patterns, and security model
- [Smart Contract Reference](docs/SMART_CONTRACT.md) — Complete API documentation with types and events
- [Frontend Architecture](docs/FRONTEND.md) — Component structure, hooks, and UX patterns
- [Demo Guide](docs/DEMO_GUIDE.md) — Step-by-step walkthrough for testing the full flow

## License

MIT
