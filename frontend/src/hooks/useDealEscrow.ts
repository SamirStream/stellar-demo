import { useCallback, useRef } from 'react';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  DEAL_ESCROW_CONTRACT,
  NETWORK_PASSPHRASE,
  sorobanServer,
} from '../lib/stellar';

// Access rpc namespace directly — stellar-base is pinned at 14.1.0 via package.json overrides,
// so the dual-class mismatch is already resolved and the any cast is unnecessary.
const rpc = StellarSdk.rpc;

const MAX_TX_POLL_RETRIES = 30; // 30 × 2s = 60s max wait

// Parse Soroban simulation errors into user-friendly messages
function friendlyError(simResult: any): string {
  const raw = JSON.stringify(simResult);
  if (raw.includes('Budget')) return 'Transaction too expensive. Try a smaller amount.';
  if (raw.includes('Storage')) return 'Contract data not found. The deal may not exist.';
  if (raw.includes('Expired')) return 'Transaction expired. Please try again.';
  if (/insufficient.balance/i.test(raw)) return 'Insufficient balance for this operation.';
  if (raw.includes('ExistingValue')) return 'This action was already performed.';
  return 'Transaction simulation failed. Please try again.';
}

export interface DealData {
  client: string;
  provider: string;
  connector: string;
  protocol_wallet: string;
  token: string;
  total_amount: bigint;
  platform_fee_bps: number;
  connector_share_bps: number;
  milestones: Array<{ amount: bigint; status: string }>;
  status: string;
  funded_amount: bigint;
}

export function useDealEscrow(
  walletAddress: string,
  signTransaction: (xdr: string, opts?: any) => Promise<string>,
  refreshBalances?: () => Promise<void>
) {
  const contractId = DEAL_ESCROW_CONTRACT;
  const txInFlight = useRef(false);

  // Helper: build, sign, and submit a transaction
  const submitContractCall = useCallback(
    async (
      operation: StellarSdk.xdr.Operation
    ): Promise<any> => {
      if (!walletAddress || !contractId) {
        throw new Error('Wallet not connected or contract not configured');
      }
      if (txInFlight.current) {
        throw new Error('A transaction is already in progress. Please wait.');
      }

      txInFlight.current = true;
      try {
        const account = await sorobanServer.getAccount(walletAddress);
        const tx = new StellarSdk.TransactionBuilder(account, {
          fee: StellarSdk.BASE_FEE, // 100 stroops — assembleTransaction will set the real simulated fee
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(operation)
          .setTimeout(120)
          .build();

        // Simulate to get footprint
        const simResult = await sorobanServer.simulateTransaction(tx);
        if (!rpc.Api.isSimulationSuccess(simResult)) {
          throw new Error(friendlyError(simResult));
        }

        // Assemble with simulation results
        const assembledTx = rpc.assembleTransaction(
          tx,
          simResult
        ).build();

        // Sign
        const signedXdr = await signTransaction(assembledTx.toXDR(), {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: walletAddress,
        });

        // Submit
        const signedTx = StellarSdk.TransactionBuilder.fromXDR(
          signedXdr,
          NETWORK_PASSPHRASE
        );
        const sendResult = await sorobanServer.sendTransaction(signedTx);

        if (sendResult.status === 'ERROR') {
          throw new Error('Transaction submission failed. Please try again.');
        }

        // Wait for confirmation with timeout
        let getResult: any;
        let retries = 0;
        do {
          if (retries >= MAX_TX_POLL_RETRIES) {
            throw new Error('Transaction confirmation timed out. Check Stellar Explorer for status.');
          }
          await new Promise((r) => setTimeout(r, 2000));
          getResult = await sorobanServer.getTransaction(sendResult.hash);
          retries++;
        } while (getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND);

        if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
          throw new Error('Transaction failed on-chain. The contract rejected the operation.');
        }

        // Attach the hash from sendResult (getTransaction doesn't always include it)
        getResult._txHash = sendResult.hash;

        // Immediately refresh wallet balance after a confirmed transaction
        if (getResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          refreshBalances?.().catch(() => {});
        }

        return getResult;
      } finally {
        txInFlight.current = false;
      }
    },
    [walletAddress, contractId, signTransaction, refreshBalances]
  );

  // Create a new deal
  const createDeal = useCallback(
    async (
      provider: string,
      connector: string,
      tokenAddress: string,
      platformFeeBps: number,
      connectorShareBps: number,
      milestoneAmounts: bigint[]
    ): Promise<{ dealId: number; txHash: string }> => {
      const contract = new StellarSdk.Contract(contractId);

      const milestonesVec = StellarSdk.nativeToScVal(
        milestoneAmounts.map((a) => a),
        { type: 'i128' } as any
      );

      const op = contract.call(
        'create_deal',
        new StellarSdk.Address(walletAddress).toScVal(),
        new StellarSdk.Address(provider).toScVal(),
        new StellarSdk.Address(connector).toScVal(),
        new StellarSdk.Address(tokenAddress).toScVal(),
        StellarSdk.nativeToScVal(platformFeeBps, { type: 'u32' }),
        StellarSdk.nativeToScVal(connectorShareBps, { type: 'u32' }),
        milestonesVec
      );

      const result = await submitContractCall(op);
      const txHash = result._txHash || result.hash || '';

      // Extract deal_id from return value
      let dealId = 0;
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        if (result.returnValue) {
          dealId = Number(StellarSdk.scValToNative(result.returnValue));
        } else if (result.resultMetaXdr) {
          try {
            const retval = result.resultMetaXdr.v3?.sorobanMeta?.returnValue;
            if (retval) dealId = Number(StellarSdk.scValToNative(retval));
          } catch { /* fallback failed, dealId stays 0 */ }
        }
      }
      if (dealId === 0 && result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error('Deal created but ID could not be read. Check Stellar Explorer with TX: ' + txHash);
      }

      return { dealId, txHash };
    },
    [contractId, walletAddress, submitContractCall]
  );

  // Deposit funds for a milestone
  const deposit = useCallback(
    async (
      dealId: number,
      milestoneIdx: number
    ): Promise<{ txHash: string }> => {
      const contract = new StellarSdk.Contract(contractId);

      const op = contract.call(
        'deposit',
        StellarSdk.nativeToScVal(dealId, { type: 'u64' }),
        StellarSdk.nativeToScVal(milestoneIdx, { type: 'u32' })
      );

      const result = await submitContractCall(op);
      const txHash = result._txHash || result.hash || '';
      return { txHash };
    },
    [contractId, submitContractCall]
  );

  // Release a milestone with atomic 3-way split
  const releaseMilestone = useCallback(
    async (
      dealId: number,
      milestoneIdx: number
    ): Promise<{ txHash: string }> => {
      const contract = new StellarSdk.Contract(contractId);

      const op = contract.call(
        'release_milestone',
        StellarSdk.nativeToScVal(dealId, { type: 'u64' }),
        StellarSdk.nativeToScVal(milestoneIdx, { type: 'u32' })
      );

      const result = await submitContractCall(op);
      const txHash = result._txHash || result.hash || '';
      return { txHash };
    },
    [contractId, submitContractCall]
  );

  // Get deal details (read-only, no signing needed)
  const getDeal = useCallback(
    async (dealId: number): Promise<DealData | null> => {
      if (!contractId) return null;

      try {
        const contract = new StellarSdk.Contract(contractId);
        const account = await sorobanServer.getAccount(walletAddress);

        const tx = new StellarSdk.TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(
            contract.call(
              'get_deal',
              StellarSdk.nativeToScVal(dealId, { type: 'u64' })
            )
          )
          .setTimeout(30)
          .build();

        const simResult = await sorobanServer.simulateTransaction(tx);
        if (
          rpc.Api.isSimulationSuccess(simResult) &&
          simResult.result
        ) {
          const raw = StellarSdk.scValToNative(simResult.result.retval);
          return raw as DealData;
        }
        return null;
      } catch {
        return null;
      }
    },
    [contractId, walletAddress]
  );

  // Get total deal count (read-only)
  const getDealCount = useCallback(
    async (): Promise<number> => {
      if (!contractId || !walletAddress) return 0;

      try {
        const contract = new StellarSdk.Contract(contractId);
        const account = await sorobanServer.getAccount(walletAddress);

        const tx = new StellarSdk.TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(contract.call('get_deal_count'))
          .setTimeout(30)
          .build();

        const simResult = await sorobanServer.simulateTransaction(tx);
        if (
          rpc.Api.isSimulationSuccess(simResult) &&
          simResult.result
        ) {
          return Number(StellarSdk.scValToNative(simResult.result.retval));
        }
        return 0;
      } catch {
        return 0;
      }
    },
    [contractId, walletAddress]
  );

  // Get provider reputation (read-only)
  const getReputation = useCallback(
    async (providerAddress: string): Promise<number> => {
      if (!contractId || !walletAddress) return 0;

      try {
        const contract = new StellarSdk.Contract(contractId);
        const account = await sorobanServer.getAccount(walletAddress);

        const tx = new StellarSdk.TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(
            contract.call(
              'get_reputation',
              new StellarSdk.Address(providerAddress).toScVal()
            )
          )
          .setTimeout(30)
          .build();

        const simResult = await sorobanServer.simulateTransaction(tx);
        if (
          rpc.Api.isSimulationSuccess(simResult) &&
          simResult.result
        ) {
          return Number(StellarSdk.scValToNative(simResult.result.retval));
        }
        return 0;
      } catch {
        return 0;
      }
    },
    [contractId, walletAddress]
  );

  // Dispute a milestone (client or provider)
  const dispute = useCallback(
    async (
      dealId: number,
      milestoneIdx: number
    ): Promise<{ txHash: string }> => {
      const contract = new StellarSdk.Contract(contractId);

      const op = contract.call(
        'dispute',
        new StellarSdk.Address(walletAddress).toScVal(),
        StellarSdk.nativeToScVal(dealId, { type: 'u64' }),
        StellarSdk.nativeToScVal(milestoneIdx, { type: 'u32' })
      );

      const result = await submitContractCall(op);
      const txHash = result._txHash || result.hash || '';
      return { txHash };
    },
    [contractId, walletAddress, submitContractCall]
  );

  // Resolve a dispute (admin only) — refundBps: 0-10000 (0%=all to provider, 10000=all to client)
  const resolveDispute = useCallback(
    async (
      dealId: number,
      milestoneIdx: number,
      refundBps: number
    ): Promise<{ txHash: string }> => {
      const contract = new StellarSdk.Contract(contractId);

      const op = contract.call(
        'resolve_dispute',
        StellarSdk.nativeToScVal(dealId, { type: 'u64' }),
        StellarSdk.nativeToScVal(milestoneIdx, { type: 'u32' }),
        StellarSdk.nativeToScVal(refundBps, { type: 'u32' })
      );

      const result = await submitContractCall(op);
      const txHash = result._txHash || result.hash || '';
      return { txHash };
    },
    [contractId, submitContractCall]
  );

  return {
    createDeal,
    deposit,
    releaseMilestone,
    dispute,
    resolveDispute,
    getDeal,
    getDealCount,
    getReputation,
    contractId,
  };
}
