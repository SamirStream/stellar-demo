# Architecture

## System Overview

The Signal's Stellar integration follows a dual-rail architecture: the production marketplace runs on traditional payment rails (Stripe Connect), while this Soroban implementation provides a trustless, on-chain alternative for the same escrow flow. Both systems implement identical business logic — the same 3-party split math, the same milestone lifecycle, and the same reputation tracking.

## Design Principles

1. **Production Parity** — The contract replicates exact split calculations from production code. A deal created through either system produces identical financial outcomes.
2. **Atomic Execution** — All milestone releases execute three token transfers in a single transaction. Either all three succeed, or none do. No partial states.
3. **Minimal Trust** — Funds never pass through The Signal's servers. They go directly from the client's wallet to the contract, and from the contract to each recipient.
4. **Composability** — The contract uses Stellar Asset Contracts (SAC) for token transfers, making it compatible with any Stellar token (XLM, USDC, or custom tokens).

## Contract Architecture

### Storage Model

The contract uses Soroban's tiered storage system:

| Storage Type | Key | Data | TTL |
|-------------|-----|------|-----|
| **Instance** | `Admin` | Admin address | Contract lifetime |
| **Instance** | `ProtocolWallet` | Protocol fee recipient | Contract lifetime |
| **Instance** | `DealCount` | Auto-incrementing counter | Contract lifetime |
| **Persistent** | `Deal(u64)` | Full deal struct | Extended |
| **Persistent** | `Reputation(Address)` | Completed deal count | Extended |

Instance storage is used for global config that rarely changes. Persistent storage is used for deal data that needs to survive ledger entry expiration.

### Deal State Machine

```
                    create_deal()
                         │
                         ▼
                    ┌─────────┐
                    │ Created │
                    └────┬────┘
                         │ deposit() (first milestone)
                         ▼
                    ┌─────────┐
              ┌─────│  Active │──────────┐
              │     └────┬────┘          │
              │          │               │
         dispute()  release_milestone() refund()
              │          │               │
              ▼          ▼               ▼
        ┌──────────┐ ┌───────────┐ ┌───────────┐
        │ Disputed │ │ Completed │ │ Cancelled │
        └────┬─────┘ └───────────┘ └───────────┘
             │
      resolve_dispute()
             │
             ▼
     (back to Active or Cancelled)
```

### Milestone Lifecycle

Each milestone within a deal follows its own state machine:

```
Pending ──deposit()──▶ Funded ──release_milestone()──▶ Released
                          │
                     dispute()
                          │
                          ▼
                     Disputed ──resolve_dispute()──▶ Refunded
```

### Split Calculation

The split is computed entirely on-chain using integer arithmetic (no floating point):

```rust
let platform_fee  = amount * platform_fee_bps / 10000;
let connector_cut = platform_fee * connector_share_bps / 10000;
let protocol_cut  = platform_fee - connector_cut;
let provider_cut  = amount - platform_fee;
```

This ensures:
- `provider_cut + connector_cut + protocol_cut == amount` (always)
- Rounding remainders go to the protocol (last party computed via subtraction)
- All values are `i128` with 7-decimal precision (Stellar standard)

### Authorization Model

| Function | Required Auth | Why |
|----------|--------------|-----|
| `create_deal` | Client | Client commits to paying |
| `deposit` | Client | Client moves their funds |
| `release_milestone` | Client | Client approves work delivery |
| `dispute` | Client OR Provider | Either party can flag issues |
| `resolve_dispute` | Admin | Neutral third-party resolution |
| `refund` | Admin | Emergency fund recovery |
| `get_deal`, `get_reputation` | None | Public read access |

### Event Emission

The contract emits events for every state change, enabling off-chain indexing:

| Event | Topics | Data |
|-------|--------|------|
| `created` | `(deal_id)` | `total_amount` |
| `funded` | `(deal_id, milestone_idx)` | `amount` |
| `released` | `(deal_id, milestone_idx)` | `(provider_cut, connector_cut, protocol_cut)` |
| `dispute` | `(deal_id, milestone_idx)` | `caller_address` |
| `resolved` | `(deal_id, milestone_idx)` | `(client_refund, provider_amount)` |
| `refund` | `(deal_id)` | `total_refunded` |
| `done` | `(deal_id)` | `reputation_count` |

## Frontend Architecture

### Component Hierarchy

```text
App.tsx (Root)
├── GlowingBackground          — Fixed ambient background (grid + orbs + scanlines)
├── ToastContainer             — Global notification system (3 max, 3s auto-dismiss)
├── LiveTicker                 — Real-time on-chain marquee (homepage only, no auth)
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

### Layer Structure

```text
Components (UI)
     │
     ▼
Custom Hooks (Business Logic)
     │
     ▼
Library Layer (SDK Wrappers)
     │
     ▼
Stellar SDK / Soroban RPC
```

### Transaction Flow

Every contract interaction follows this pipeline:

```
1. Build Transaction
   └── TransactionBuilder + contract.call()

2. Simulate
   └── sorobanServer.simulateTransaction()
   └── Get storage footprint + resource estimates

3. Assemble
   └── rpc.assembleTransaction() adds simulation results

4. Sign
   └── StellarWalletsKit.signTransaction()
   └── User approves in wallet extension

5. Submit
   └── sorobanServer.sendTransaction()

6. Poll for Confirmation
   └── sorobanServer.getTransaction() every 2s
   └── Max 30 retries (60s timeout)

7. Parse Result
   └── scValToNative() to decode return values
```

### Error Handling Strategy

The frontend translates Soroban errors into user-friendly messages:

| Soroban Error | User Message |
|---------------|-------------|
| `HostError(Budget)` | "Transaction too expensive. Try a smaller amount." |
| `HostError(Storage)` | "Contract data not found. The deal may not exist." |
| `InvokeHostFunctionEntryExpired` | "Transaction expired. Please try again." |
| `insufficient balance` | "Insufficient balance for this operation." |
| User cancels wallet signing | "Transaction cancelled by user." |
| Confirmation timeout (60s) | "Transaction confirmation timed out. Check Stellar Explorer." |

### Security Measures

- **Transaction mutex**: Prevents double-click submitting two transactions with the same sequence number
- **Balance validation**: Checks wallet balance before attempting deposits (avoids cryptic simulation errors)
- **Address validation**: Validates Stellar public key format (G-prefix, 56 chars, base32) before submission
- **Milestone validation**: Enforces all milestones > 0% before deal creation

## Integration with The Signal

### How the Systems Connect

The Signal's production marketplace manages the business workflow (discovery, matching, negotiation). When parties agree on a deal:

**Traditional Flow (Current)**:
```
Deal Agreement → Stripe Checkout → Milestone Tracking → Stripe Connect Payout
```

**Stellar Flow (This Demo)**:
```
Deal Agreement → Soroban deposit() → Milestone Tracking → Soroban release_milestone()
```

The smart contract replaces the payment processor while the marketplace handles everything else (user profiles, deal discovery, communication, content).

### BD Connector Tier System

The Signal's connector share is tiered based on the connector's lifetime performance:

| Tier | Connector Share | Required |
|------|----------------|----------|
| Explorer | 40% of fee | Default |
| Navigator | 50% of fee | 5+ deals |
| Architect | 65% of fee | 15+ deals |

This is parameterized per deal via `connector_share_bps`, so different connector tiers create deals with different split ratios — all enforced on-chain.

## Deployment

### Testnet

The current deployment uses Stellar's public testnet:

- **RPC**: `https://soroban-testnet.stellar.org`
- **Horizon**: `https://horizon-testnet.stellar.org`
- **Explorer**: [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet)
- **Friendbot**: Available for free 10,000 XLM funding

### Mainnet Considerations

For production deployment:

1. **Storage rent**: Persistent storage requires rent payments. Deals should include a rent reserve or use TTL management.
2. **Fee estimation**: Production should use dynamic fee estimation instead of the fixed 1 XLM max fee used in testnet.
3. **Token support**: Replace XLM SAC with production USDC or other stablecoins.
4. **Admin key management**: Use a multisig or DAO-controlled admin address.
5. **Contract upgrades**: Consider implementing a proxy pattern or versioned storage for future upgrades.
