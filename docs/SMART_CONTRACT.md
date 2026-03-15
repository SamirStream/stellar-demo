# Smart Contract Reference

## Overview

The `DealEscrowContract` is a Soroban smart contract that implements milestone-based escrow with atomic 3-way payment splits. It is written in Rust using `soroban-sdk` v22.0.0.

**Contract ID (Testnet)**: `CASW4L3WIFJDL2ZOBKBEMO6GV5O34DRBURRUF2EPRFFIQLJHZMSUK7IC`

**Source**: [`contracts/deal_escrow/src/lib.rs`](../contracts/deal_escrow/src/lib.rs)

## Types

### MilestoneStatus

```rust
enum MilestoneStatus {
    Pending,    // Created, awaiting funding
    Funded,     // Client deposited tokens
    Released,   // Split executed, funds distributed
    Disputed,   // Frozen by client or provider
    Refunded,   // Returned to client after dispute resolution
}
```

### DealStatus

```rust
enum DealStatus {
    Created,    // Deal parameters set, no funding yet
    Active,     // At least one milestone funded
    Completed,  // All milestones released
    Cancelled,  // All milestones refunded
    Disputed,   // At least one milestone disputed
}
```

### Milestone

```rust
struct Milestone {
    amount: i128,              // Token amount (7 decimal precision)
    status: MilestoneStatus,
}
```

### Deal

```rust
struct Deal {
    client: Address,           // Who pays (escrow depositor)
    provider: Address,         // Who delivers (receives bulk payment)
    connector: Address,        // Who referred (receives commission)
    protocol_wallet: Address,  // Platform fee recipient
    token: Address,            // SAC token contract address
    total_amount: i128,        // Sum of all milestone amounts
    platform_fee_bps: u32,     // Platform fee in basis points (1000 = 10%)
    connector_share_bps: u32,  // Connector's share of fee (4000 = 40%)
    milestones: Vec<Milestone>,
    status: DealStatus,
    funded_amount: i128,       // Total currently held in escrow
}
```

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 1 | `NotInitialized` | Contract has not been initialized |
| 2 | `AlreadyInitialized` | `initialize()` called twice |
| 3 | `Unauthorized` | Caller does not have permission |
| 4 | `DealNotFound` | No deal exists with this ID |
| 5 | `InvalidMilestone` | Milestone index out of bounds |
| 6 | `MilestoneNotPending` | Expected Pending status |
| 7 | `MilestoneNotFunded` | Expected Funded status |
| 8 | `DealNotActive` | Deal is not in Active state |
| 9 | `InvalidAmount` | Zero or negative amount |
| 10 | `InvalidSplit` | Fee or share exceeds 100% |
| 11 | `AlreadyFunded` | Milestone already deposited |

## Functions

### initialize

```rust
fn initialize(env: Env, admin: Address, protocol_wallet: Address) -> Result<(), EscrowError>
```

One-time contract setup. Must be called before any other function.

**Parameters**:
- `admin` — Address authorized for dispute resolution and refunds
- `protocol_wallet` — Address that receives the protocol's share of fees

**Errors**: `AlreadyInitialized` if called more than once.

---

### create_deal

```rust
fn create_deal(
    env: Env,
    client: Address,
    provider: Address,
    connector: Address,
    token_addr: Address,
    platform_fee_bps: u32,
    connector_share_bps: u32,
    milestone_amounts: Vec<i128>,
) -> Result<u64, EscrowError>
```

Creates a new deal with defined participants and milestones.

**Authorization**: `client.require_auth()`

**Parameters**:
- `client` — The party depositing funds
- `provider` — The party delivering services
- `connector` — The BD referrer who connected the parties
- `token_addr` — SAC token address (XLM, USDC, etc.)
- `platform_fee_bps` — Total platform fee as basis points (1000 = 10%)
- `connector_share_bps` — Connector's share of the platform fee (4000 = 40%)
- `milestone_amounts` — Vector of amounts for each milestone

**Returns**: `deal_id` (auto-incrementing `u64`)

**Validation**:
- `platform_fee_bps` and `connector_share_bps` must be ≤ 10000
- `milestone_amounts` cannot be empty
- Each amount must be > 0

**Events**: `("created", deal_id) → total_amount`

---

### deposit

```rust
fn deposit(env: Env, deal_id: u64, milestone_idx: u32) -> Result<(), EscrowError>
```

Funds a specific milestone by transferring tokens from client to contract.

**Authorization**: `deal.client.require_auth()`

**Flow**:
1. Validates milestone is in `Pending` status
2. Executes SAC `transfer(client → contract, amount)`
3. Updates milestone to `Funded`
4. If first deposit, updates deal to `Active`

**Events**: `("funded", deal_id, milestone_idx) → amount`

---

### release_milestone

```rust
fn release_milestone(env: Env, deal_id: u64, milestone_idx: u32) -> Result<(), EscrowError>
```

Releases a funded milestone with atomic 3-way split.

**Authorization**: `deal.client.require_auth()`

**Split Calculation**:
```
platform_fee  = amount × platform_fee_bps / 10000
connector_cut = platform_fee × connector_share_bps / 10000
protocol_cut  = platform_fee - connector_cut
provider_cut  = amount - platform_fee
```

**Flow**:
1. Validates deal is `Active` and milestone is `Funded`
2. Computes three payment amounts
3. Executes three atomic transfers: provider, connector, protocol
4. Updates milestone to `Released`
5. If all milestones released: sets deal to `Completed` and increments provider reputation

**Events**:
- `("released", deal_id, milestone_idx) → (provider_cut, connector_cut, protocol_cut)`
- `("done", deal_id) → reputation_count` (only when all milestones complete)

---

### dispute

```rust
fn dispute(env: Env, caller: Address, deal_id: u64, milestone_idx: u32) -> Result<(), EscrowError>
```

Freezes a funded milestone. Can be called by either client or provider.

**Authorization**: `caller.require_auth()` — must be deal's client or provider.

**Flow**:
1. Validates milestone is `Funded`
2. Updates milestone to `Disputed`
3. Updates deal to `Disputed`

**Events**: `("dispute", deal_id, milestone_idx) → caller`

---

### resolve_dispute

```rust
fn resolve_dispute(
    env: Env,
    deal_id: u64,
    milestone_idx: u32,
    refund_bps: u32,
) -> Result<(), EscrowError>
```

Admin resolves a dispute by splitting funds between client and provider.

**Authorization**: `admin.require_auth()`

**Parameters**:
- `refund_bps` — Percentage to refund client (0 = all to provider, 5000 = 50/50, 10000 = full refund)

**Flow**:
1. Computes `client_refund = amount × refund_bps / 10000`
2. Computes `provider_amount = amount - client_refund`
3. Transfers both amounts
4. Updates milestone to `Refunded`
5. If no more active milestones, cancels the deal

**Events**: `("resolved", deal_id, milestone_idx) → (client_refund, provider_amount)`

---

### refund

```rust
fn refund(env: Env, deal_id: u64) -> Result<(), EscrowError>
```

Full refund of all funded or disputed milestones. Admin only.

**Authorization**: `admin.require_auth()`

**Flow**:
1. Iterates all milestones
2. Refunds every `Funded` or `Disputed` milestone to client
3. Sets deal to `Cancelled`

**Events**: `("refund", deal_id) → total_refunded`

---

### get_deal

```rust
fn get_deal(env: Env, deal_id: u64) -> Result<Deal, EscrowError>
```

Read-only. Returns the full deal struct.

---

### get_deal_count

```rust
fn get_deal_count(env: Env) -> Result<u64, EscrowError>
```

Read-only. Returns the total number of deals created.

---

### get_reputation

```rust
fn get_reputation(env: Env, provider: Address) -> u64
```

Read-only. Returns the number of completed deals for a provider address. Returns 0 if no deals completed.

## Test Coverage

The contract includes 10 unit tests covering:

1. **Happy path** — Single milestone: create, fund, release, verify exact split amounts ($9,000 / $400 / $600 on a $10,000 deal)
2. **Multi-milestone** — Three milestones (30/50/20) totaling $100,000
3. **Reputation** — Counter increments correctly across multiple deals
4. **Dispute resolution** — Freeze + admin 50/50 split
5. **Full refund** — Admin returns all escrowed funds
6. **Authorization** — Non-client deposit panics with auth error
7. **Double deposit** — Same milestone cannot be funded twice
8. **Release unfunded** — Cannot release a Pending milestone
9. **Deal counter** — Increments correctly across multiple deals
10. **Variable rates** — Architect tier (65%) connector share

Run tests:
```bash
cargo test
```

## Build and Deploy

```bash
# Build optimized WASM
stellar contract build
stellar contract optimize --wasm target/wasm32v1-none/release/deal_escrow.wasm

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/deal_escrow.wasm \
  --source-account deployer \
  --network testnet

# Initialize
stellar contract invoke --id <CONTRACT_ID> --source-account deployer --network testnet \
  -- initialize --admin <ADMIN_ADDRESS> --protocol_wallet <PROTOCOL_ADDRESS>
```

## CLI Invocation Examples

```bash
# Create a deal ($500 XLM, 10% fee, 40% connector share, 2 milestones)
stellar contract invoke --id <CONTRACT_ID> --source-account client --network testnet \
  -- create_deal \
  --client <CLIENT_ADDR> \
  --provider <PROVIDER_ADDR> \
  --connector <CONNECTOR_ADDR> \
  --token_addr CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --platform_fee_bps 1000 \
  --connector_share_bps 4000 \
  --milestone_amounts '[2500000000, 2500000000]'

# Deposit for milestone 0
stellar contract invoke --id <CONTRACT_ID> --source-account client --network testnet \
  -- deposit --deal_id 0 --milestone_idx 0

# Release milestone 0
stellar contract invoke --id <CONTRACT_ID> --source-account client --network testnet \
  -- release_milestone --deal_id 0 --milestone_idx 0

# Check reputation
stellar contract invoke --id <CONTRACT_ID> --network testnet \
  -- get_reputation --provider <PROVIDER_ADDR>
```
