#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, token, Address, Env, Vec,
};

// =====================================================
// TYPES
// =====================================================

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    Funded,
    Released,
    Disputed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DealStatus {
    Created,
    Active,
    Completed,
    Cancelled,
    Disputed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub amount: i128,
    pub status: MilestoneStatus,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Deal {
    pub client: Address,
    pub provider: Address,
    pub connector: Address,
    pub protocol_wallet: Address,
    pub token: Address,
    pub total_amount: i128,
    pub platform_fee_bps: u32,
    pub connector_share_bps: u32,
    pub milestones: Vec<Milestone>,
    pub status: DealStatus,
    pub funded_amount: i128,
}

#[contracttype]
pub enum DataKey {
    Deal(u64),
    DealCount,
    Admin,
    ProtocolWallet,
    Reputation(Address),
}

// =====================================================
// ERRORS
// =====================================================

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum EscrowError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    DealNotFound = 4,
    InvalidMilestone = 5,
    MilestoneNotPending = 6,
    MilestoneNotFunded = 7,
    DealNotActive = 8,
    InvalidAmount = 9,
    InvalidSplit = 10,
    AlreadyFunded = 11,
}

// =====================================================
// CONTRACT
// =====================================================

#[contract]
pub struct DealEscrowContract;

#[contractimpl]
impl DealEscrowContract {
    /// Initialize the contract with admin and protocol wallet addresses.
    /// Must be called once before any other function.
    pub fn initialize(
        env: Env,
        admin: Address,
        protocol_wallet: Address,
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ProtocolWallet, &protocol_wallet);
        env.storage().instance().set(&DataKey::DealCount, &0u64);

        Ok(())
    }

    /// Create a new deal with defined participants, splits, and milestones.
    ///
    /// - `platform_fee_bps`: platform fee in basis points (1000 = 10%)
    /// - `connector_share_bps`: connector's share of the platform fee in bps (4000 = 40%)
    /// - `milestone_amounts`: vector of amounts for each milestone (in token units)
    pub fn create_deal(
        env: Env,
        client: Address,
        provider: Address,
        connector: Address,
        token_addr: Address,
        platform_fee_bps: u32,
        connector_share_bps: u32,
        milestone_amounts: Vec<i128>,
    ) -> Result<u64, EscrowError> {
        // Client must authorize deal creation
        client.require_auth();

        if platform_fee_bps > 10000 || connector_share_bps > 10000 {
            return Err(EscrowError::InvalidSplit);
        }

        if milestone_amounts.is_empty() {
            return Err(EscrowError::InvalidAmount);
        }

        // Calculate total amount
        let mut total: i128 = 0;
        let mut milestones = Vec::new(&env);
        for i in 0..milestone_amounts.len() {
            let amt = milestone_amounts.get(i).unwrap();
            if amt <= 0 {
                return Err(EscrowError::InvalidAmount);
            }
            total += amt;
            milestones.push_back(Milestone {
                amount: amt,
                status: MilestoneStatus::Pending,
            });
        }

        // Get protocol wallet from storage
        let protocol_wallet: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolWallet)
            .ok_or(EscrowError::NotInitialized)?;

        // Get and increment deal counter
        let deal_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DealCount)
            .ok_or(EscrowError::NotInitialized)?;

        let deal = Deal {
            client,
            provider,
            connector,
            protocol_wallet,
            token: token_addr,
            total_amount: total,
            platform_fee_bps,
            connector_share_bps,
            milestones,
            status: DealStatus::Created,
            funded_amount: 0,
        };

        env.storage().persistent().set(&DataKey::Deal(deal_id), &deal);
        env.storage()
            .instance()
            .set(&DataKey::DealCount, &(deal_id + 1));

        // Emit event
        env.events()
            .publish((symbol_short!("created"), deal_id), deal.total_amount);

        Ok(deal_id)
    }

    /// Deposit funds for a specific milestone.
    /// Client transfers tokens from their wallet to this contract.
    pub fn deposit(env: Env, deal_id: u64, milestone_idx: u32) -> Result<(), EscrowError> {
        let mut deal: Deal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
            .ok_or(EscrowError::DealNotFound)?;

        // Client must authorize
        deal.client.require_auth();

        let idx = milestone_idx as u32;
        if idx >= deal.milestones.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let mut milestone = deal.milestones.get(idx).unwrap();
        if milestone.status != MilestoneStatus::Pending {
            return Err(EscrowError::AlreadyFunded);
        }

        // Transfer tokens from client to contract
        let token_client = token::Client::new(&env, &deal.token);
        token_client.transfer(
            &deal.client,
            &env.current_contract_address(),
            &milestone.amount,
        );

        // Update milestone status
        milestone.status = MilestoneStatus::Funded;
        deal.milestones.set(idx, milestone.clone());
        deal.funded_amount += milestone.amount;

        // Update deal status if first funding
        if deal.status == DealStatus::Created {
            deal.status = DealStatus::Active;
        }

        env.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        // Emit event
        env.events()
            .publish((symbol_short!("funded"), deal_id, milestone_idx), milestone.amount);

        Ok(())
    }

    /// Release a funded milestone with atomic 3-way split.
    ///
    /// Split logic (mirrors The Signal's approveMilestone):
    /// - platform_fee = amount * platform_fee_bps / 10000
    /// - connector_cut = platform_fee * connector_share_bps / 10000
    /// - protocol_cut = platform_fee - connector_cut
    /// - provider_cut = amount - platform_fee
    pub fn release_milestone(
        env: Env,
        deal_id: u64,
        milestone_idx: u32,
    ) -> Result<(), EscrowError> {
        let mut deal: Deal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
            .ok_or(EscrowError::DealNotFound)?;

        // Client must authorize release
        deal.client.require_auth();

        if deal.status != DealStatus::Active {
            return Err(EscrowError::DealNotActive);
        }

        let idx = milestone_idx as u32;
        if idx >= deal.milestones.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let mut milestone = deal.milestones.get(idx).unwrap();
        if milestone.status != MilestoneStatus::Funded {
            return Err(EscrowError::MilestoneNotFunded);
        }

        // Calculate splits
        let amount = milestone.amount;
        let platform_fee = amount * (deal.platform_fee_bps as i128) / 10000;
        let connector_cut = platform_fee * (deal.connector_share_bps as i128) / 10000;
        let protocol_cut = platform_fee - connector_cut;
        let provider_cut = amount - platform_fee;

        // Execute atomic 3-way transfer
        let token_client = token::Client::new(&env, &deal.token);
        let contract_addr = env.current_contract_address();

        // 1. Provider gets their share
        if provider_cut > 0 {
            token_client.transfer(&contract_addr, &deal.provider, &provider_cut);
        }

        // 2. Connector (BD) gets their commission
        if connector_cut > 0 {
            token_client.transfer(&contract_addr, &deal.connector, &connector_cut);
        }

        // 3. Protocol gets the remainder
        if protocol_cut > 0 {
            token_client.transfer(&contract_addr, &deal.protocol_wallet, &protocol_cut);
        }

        // Update milestone status
        milestone.status = MilestoneStatus::Released;
        deal.milestones.set(idx, milestone);

        // Check if all milestones are released → complete the deal
        let all_released = (0..deal.milestones.len()).all(|i| {
            let m = deal.milestones.get(i).unwrap();
            m.status == MilestoneStatus::Released
        });

        if all_released {
            deal.status = DealStatus::Completed;

            // Increment provider's on-chain reputation counter
            let rep_key = DataKey::Reputation(deal.provider.clone());
            let current: u64 = env.storage().persistent().get(&rep_key).unwrap_or(0);
            env.storage().persistent().set(&rep_key, &(current + 1));

            // Emit completion event
            env.events()
                .publish((symbol_short!("done"), deal_id), current + 1);
        }

        env.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        // Emit release event with split details
        env.events().publish(
            (symbol_short!("released"), deal_id, milestone_idx),
            (provider_cut, connector_cut, protocol_cut),
        );

        Ok(())
    }

    /// Raise a dispute on a funded milestone. Freezes funds.
    /// Can be called by either client or provider.
    pub fn dispute(
        env: Env,
        caller: Address,
        deal_id: u64,
        milestone_idx: u32,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let mut deal: Deal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
            .ok_or(EscrowError::DealNotFound)?;

        // Only client or provider can dispute
        if caller != deal.client && caller != deal.provider {
            return Err(EscrowError::Unauthorized);
        }

        let idx = milestone_idx as u32;
        if idx >= deal.milestones.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let mut milestone = deal.milestones.get(idx).unwrap();
        if milestone.status != MilestoneStatus::Funded {
            return Err(EscrowError::MilestoneNotFunded);
        }

        milestone.status = MilestoneStatus::Disputed;
        deal.milestones.set(idx, milestone);
        deal.status = DealStatus::Disputed;

        env.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        env.events()
            .publish((symbol_short!("dispute"), deal_id, milestone_idx), caller);

        Ok(())
    }

    /// Resolve a dispute. Admin splits funds between client and provider.
    /// `refund_bps`: percentage to refund client (5000 = 50%)
    pub fn resolve_dispute(
        env: Env,
        deal_id: u64,
        milestone_idx: u32,
        refund_bps: u32,
    ) -> Result<(), EscrowError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;
        admin.require_auth();

        if refund_bps > 10000 {
            return Err(EscrowError::InvalidSplit);
        }

        let mut deal: Deal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
            .ok_or(EscrowError::DealNotFound)?;

        let idx = milestone_idx as u32;
        if idx >= deal.milestones.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let mut milestone = deal.milestones.get(idx).unwrap();
        if milestone.status != MilestoneStatus::Disputed {
            return Err(EscrowError::MilestoneNotFunded); // reusing error for wrong state
        }

        let amount = milestone.amount;
        let client_refund = amount * (refund_bps as i128) / 10000;
        let provider_amount = amount - client_refund;

        let token_client = token::Client::new(&env, &deal.token);
        let contract_addr = env.current_contract_address();

        if client_refund > 0 {
            token_client.transfer(&contract_addr, &deal.client, &client_refund);
        }
        if provider_amount > 0 {
            token_client.transfer(&contract_addr, &deal.provider, &provider_amount);
        }

        milestone.status = MilestoneStatus::Refunded;
        deal.milestones.set(idx, milestone);

        // Check if any milestones are still active
        let has_active = (0..deal.milestones.len()).any(|i| {
            let m = deal.milestones.get(i).unwrap();
            m.status == MilestoneStatus::Funded || m.status == MilestoneStatus::Disputed
        });

        if !has_active {
            deal.status = DealStatus::Cancelled;
        } else {
            deal.status = DealStatus::Active;
        }

        env.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        env.events().publish(
            (symbol_short!("resolved"), deal_id, milestone_idx),
            (client_refund, provider_amount),
        );

        Ok(())
    }

    /// Full refund of all funded milestones. Admin only.
    pub fn refund(env: Env, deal_id: u64) -> Result<(), EscrowError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;
        admin.require_auth();

        let mut deal: Deal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
            .ok_or(EscrowError::DealNotFound)?;

        let token_client = token::Client::new(&env, &deal.token);
        let contract_addr = env.current_contract_address();

        let mut refunded: i128 = 0;

        for i in 0..deal.milestones.len() {
            let mut milestone = deal.milestones.get(i).unwrap();
            if milestone.status == MilestoneStatus::Funded
                || milestone.status == MilestoneStatus::Disputed
            {
                token_client.transfer(&contract_addr, &deal.client, &milestone.amount);
                refunded += milestone.amount;
                milestone.status = MilestoneStatus::Refunded;
                deal.milestones.set(i, milestone);
            }
        }

        deal.status = DealStatus::Cancelled;
        deal.funded_amount -= refunded;

        env.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        env.events()
            .publish((symbol_short!("refund"), deal_id), refunded);

        Ok(())
    }

    // =====================================================
    // READ-ONLY QUERIES
    // =====================================================

    /// Get deal details by ID.
    pub fn get_deal(env: Env, deal_id: u64) -> Result<Deal, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
            .ok_or(EscrowError::DealNotFound)
    }

    /// Get total number of deals created.
    pub fn get_deal_count(env: Env) -> Result<u64, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::DealCount)
            .ok_or(EscrowError::NotInitialized)
    }

    /// Get provider's on-chain reputation (completed deal count).
    pub fn get_reputation(env: Env, provider: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(provider))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
