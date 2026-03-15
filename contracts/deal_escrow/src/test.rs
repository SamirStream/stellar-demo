#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Env,
};

/// Helper: set up a full test environment with initialized contract and test token
fn setup_env() -> (
    Env,
    Address,   // contract_id
    Address,   // admin
    Address,   // client
    Address,   // provider
    Address,   // connector
    Address,   // token_id
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DealEscrowContract, ());
    let admin = Address::generate(&env);
    let client = Address::generate(&env);
    let provider = Address::generate(&env);
    let connector = Address::generate(&env);

    // Create a test SAC token (simulates USDC)
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let sac_client = StellarAssetClient::new(&env, &token_id);

    // Mint tokens to client (1,000,000 USDC with 7 decimals)
    sac_client.mint(&client, &10_000_000_0000000);

    // Initialize contract
    let escrow = DealEscrowContractClient::new(&env, &contract_id);
    escrow.initialize(&admin, &admin); // admin is also protocol_wallet for tests

    (env, contract_id, admin, client, provider, connector, token_id)
}

// =====================================================
// TEST 1: Happy Path — Create, Deposit, Release
// =====================================================

#[test]
fn test_happy_path_single_milestone() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_id);

    // Create deal: $10,000 USDC (7 decimals), 10% fee, 40% connector share
    let milestone_amounts = vec![&env, 100_000_0000000i128]; // $10,000
    let deal_id = escrow.create_deal(
        &client,
        &provider,
        &connector,
        &token_id,
        &1000u32,  // 10% platform fee
        &4000u32,  // 40% connector share of fee
        &milestone_amounts,
    );
    assert_eq!(deal_id, 0);

    // Verify deal created
    let deal = escrow.get_deal(&deal_id);
    assert_eq!(deal.status, DealStatus::Created);
    assert_eq!(deal.total_amount, 100_000_0000000i128);

    // Deposit for milestone 0
    escrow.deposit(&deal_id, &0u32);

    let deal = escrow.get_deal(&deal_id);
    assert_eq!(deal.status, DealStatus::Active);
    assert_eq!(deal.milestones.get(0).unwrap().status, MilestoneStatus::Funded);

    // Check contract received funds
    assert_eq!(token.balance(&contract_id), 100_000_0000000i128);

    // Release milestone 0
    escrow.release_milestone(&deal_id, &0u32);

    let deal = escrow.get_deal(&deal_id);
    assert_eq!(deal.status, DealStatus::Completed);
    assert_eq!(deal.milestones.get(0).unwrap().status, MilestoneStatus::Released);

    // Verify splits:
    // platform_fee = 10,000 * 10% = 1,000
    // connector_cut = 1,000 * 40% = 400
    // protocol_cut = 1,000 - 400 = 600
    // provider_cut = 10,000 - 1,000 = 9,000
    assert_eq!(token.balance(&provider), 90_000_0000000i128);   // $9,000
    assert_eq!(token.balance(&connector), 4_000_0000000i128);   // $400
    assert_eq!(token.balance(&admin), 6_000_0000000i128);       // $600 (admin = protocol_wallet)
    assert_eq!(token.balance(&contract_id), 0);                  // Contract empty
}

// =====================================================
// TEST 2: Multi-Milestone (30/50/20 split)
// =====================================================

#[test]
fn test_multi_milestone_30_50_20() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_id);

    // $100,000 deal with 3 milestones: 30%, 50%, 20%
    let milestone_amounts = vec![
        &env,
        300_000_0000000i128, // $30,000
        500_000_0000000i128, // $50,000
        200_000_0000000i128, // $20,000
    ];

    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &milestone_amounts,
    );

    // Fund and release all 3 milestones sequentially
    for i in 0u32..3 {
        escrow.deposit(&deal_id, &i);
        escrow.release_milestone(&deal_id, &i);
    }

    let deal = escrow.get_deal(&deal_id);
    assert_eq!(deal.status, DealStatus::Completed);

    // Total: $100,000
    // Provider: 90% = $90,000
    // Connector: 4% = $4,000
    // Protocol: 6% = $6,000
    assert_eq!(token.balance(&provider), 900_000_0000000i128);
    assert_eq!(token.balance(&connector), 40_000_0000000i128);
    assert_eq!(token.balance(&admin), 60_000_0000000i128);
}

// =====================================================
// TEST 3: Reputation Counter
// =====================================================

#[test]
fn test_reputation_increments() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);

    // Initial reputation = 0
    assert_eq!(escrow.get_reputation(&provider), 0);

    // Complete first deal
    let amounts = vec![&env, 10_000_0000000i128];
    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );
    escrow.deposit(&deal_id, &0u32);
    escrow.release_milestone(&deal_id, &0u32);

    assert_eq!(escrow.get_reputation(&provider), 1);

    // Complete second deal
    let deal_id2 = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );
    escrow.deposit(&deal_id2, &0u32);
    escrow.release_milestone(&deal_id2, &0u32);

    assert_eq!(escrow.get_reputation(&provider), 2);
}

// =====================================================
// TEST 4: Dispute + Resolve
// =====================================================

#[test]
fn test_dispute_and_resolve() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_id);

    let amounts = vec![&env, 50_000_0000000i128]; // $5,000
    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );

    escrow.deposit(&deal_id, &0u32);

    // Client disputes
    escrow.dispute(&client, &deal_id, &0u32);

    let deal = escrow.get_deal(&deal_id);
    assert_eq!(deal.status, DealStatus::Disputed);
    assert_eq!(deal.milestones.get(0).unwrap().status, MilestoneStatus::Disputed);

    // Admin resolves: 50% refund to client, 50% to provider
    escrow.resolve_dispute(&deal_id, &0u32, &5000u32);

    let deal = escrow.get_deal(&deal_id);
    assert_eq!(deal.milestones.get(0).unwrap().status, MilestoneStatus::Refunded);

    // Client gets 50% = $2,500
    // Provider gets 50% = $2,500
    let client_balance = token.balance(&client);
    let provider_balance = token.balance(&provider);
    // Client started with $1M, funded $5K, got $2.5K back = $997,500
    assert_eq!(client_balance, 9_975_000_0000000i128);
    assert_eq!(provider_balance, 25_000_0000000i128);
}

// =====================================================
// TEST 5: Full Refund
// =====================================================

#[test]
fn test_full_refund() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_id);

    let client_initial = token.balance(&client);

    let amounts = vec![&env, 30_000_0000000i128, 70_000_0000000i128]; // $3K + $7K
    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );

    // Fund both milestones
    escrow.deposit(&deal_id, &0u32);
    escrow.deposit(&deal_id, &1u32);

    assert_eq!(token.balance(&contract_id), 100_000_0000000i128); // $10K in escrow

    // Admin initiates full refund
    escrow.refund(&deal_id);

    let deal = escrow.get_deal(&deal_id);
    assert_eq!(deal.status, DealStatus::Cancelled);
    assert_eq!(token.balance(&client), client_initial); // Client got all back
    assert_eq!(token.balance(&contract_id), 0); // Contract empty
}

// =====================================================
// TEST 6: Auth Checks
// =====================================================

#[test]
#[should_panic(expected = "HostError: Error(Auth")]
fn test_unauthorized_deposit() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();

    // Don't mock all auths - we want real auth checks
    let env = Env::default();
    let contract_id = env.register(DealEscrowContract, ());
    let admin = Address::generate(&env);
    let client = Address::generate(&env);
    let provider = Address::generate(&env);
    let connector = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let sac_client = StellarAssetClient::new(&env, &token_id);
    sac_client.mint(&client, &10_000_000_0000000);

    // Initialize with mock auth for admin only
    env.mock_all_auths();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);
    escrow.initialize(&admin, &admin);

    let amounts = vec![&env, 10_000_0000000i128];
    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );

    // Now disable mocked auth — deposit should require client auth
    env.mock_auths(&[]);
    escrow.deposit(&deal_id, &0u32); // Should panic: unauthorized
}

// =====================================================
// TEST 7: Double Deposit Prevention
// =====================================================

#[test]
fn test_double_deposit_fails() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);

    let amounts = vec![&env, 10_000_0000000i128];
    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );

    escrow.deposit(&deal_id, &0u32);

    // Second deposit on same milestone should fail
    let result = escrow.try_deposit(&deal_id, &0u32);
    assert!(result.is_err());
}

// =====================================================
// TEST 8: Release Unfunded Milestone Fails
// =====================================================

#[test]
fn test_release_unfunded_fails() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);

    let amounts = vec![&env, 10_000_0000000i128];
    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );

    // Fund to make deal Active, then try releasing unfunded milestone
    // Actually: deal is still Created, not Active, so DealNotActive error
    let result = escrow.try_release_milestone(&deal_id, &0u32);
    assert!(result.is_err());
}

// =====================================================
// TEST 9: Deal Count Tracking
// =====================================================

#[test]
fn test_deal_count() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);

    assert_eq!(escrow.get_deal_count(), 0);

    let amounts = vec![&env, 10_000_0000000i128];

    escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );
    assert_eq!(escrow.get_deal_count(), 1);

    escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32, &4000u32, &amounts,
    );
    assert_eq!(escrow.get_deal_count(), 2);
}

// =====================================================
// TEST 10: Variable Commission Rates
// =====================================================

#[test]
fn test_architect_tier_65_percent() {
    let (env, contract_id, admin, client, provider, connector, token_id) = setup_env();
    let escrow = DealEscrowContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_id);

    // Architect tier: 65% of platform fee goes to connector
    let amounts = vec![&env, 100_000_0000000i128]; // $10,000
    let deal_id = escrow.create_deal(
        &client, &provider, &connector, &token_id,
        &1000u32,  // 10% platform fee
        &6500u32,  // 65% connector share (Architect tier)
        &amounts,
    );

    escrow.deposit(&deal_id, &0u32);
    escrow.release_milestone(&deal_id, &0u32);

    // $10,000 deal:
    // Platform fee = $1,000
    // Connector (65%) = $650
    // Protocol (35%) = $350
    // Provider = $9,000
    assert_eq!(token.balance(&provider), 90_000_0000000i128);   // $9,000
    assert_eq!(token.balance(&connector), 6_500_0000000i128);   // $650
    assert_eq!(token.balance(&admin), 3_500_0000000i128);       // $350
}
