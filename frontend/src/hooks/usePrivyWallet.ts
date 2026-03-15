/**
 * usePrivyWallet.ts
 *
 * WalletState-compatible hook powered by Privy embedded wallets.
 * Users authenticate with email / Google / Twitter / Discord → Privy
 * auto-creates an Ed25519 Stellar wallet → signing goes through Privy's
 * rawSign API without ever leaving the browser.
 *
 * Signing bridge:
 *   XDR → getStellarTxHash → signRawHash (Privy popup) → assembleStellarSignedTx → signed XDR
 *
 * Key API notes:
 *  - useCreateWallet and useSignRawHash come from @privy-io/react-auth/extended-chains
 *    (not the main package) — those are the Tier-2 / non-EVM hooks.
 *  - useWallets() returns EVM wallets only; Stellar wallets live in user.linkedAccounts
 *    as WalletWithMetadata entries with chainType === 'stellar'.
 *  - signRawHash expects hash: `0x${string}` (template literal type).
 */
import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import type { WalletWithMetadata } from '@privy-io/react-auth';
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains';
import {
  getXlmBalance,
  getTokenBalance,
  formatAmount,
  USDC_TOKEN_ADDRESS,
} from '../lib/stellar';
import { getStellarTxHash, assembleStellarSignedTx } from '../lib/privy-stellar';
import type { WalletState } from './useStellarWallet';

export interface PrivyWalletState extends WalletState {
  /** true once Privy SDK has finished initialising */
  isPrivyReady: boolean;
  /** Call this to open Privy's login modal (email/social) */
  privyLogin: () => void;
}

export function usePrivyWallet(): PrivyWalletState {
  const { ready, authenticated, logout, login, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  const [xlmBalance, setXlmBalance] = useState('0');
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [networkWarning] = useState<string | null>(null);

  // Stellar embedded wallets are NOT in useWallets() (EVM-only) — they live in
  // user.linkedAccounts as WalletWithMetadata entries.
  const stellarWallet = user?.linkedAccounts.find(
    (a): a is WalletWithMetadata =>
      a.type === 'wallet' &&
      (a as WalletWithMetadata).chainType === 'stellar' &&
      (a as WalletWithMetadata).walletClientType === 'privy'
  );

  const address = stellarWallet?.address ?? '';
  const isConnected = authenticated && !!stellarWallet;

  // After Privy login, auto-create the Stellar wallet if it doesn't exist yet
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (stellarWallet) return; // already exists

    createWallet({ chainType: 'stellar' }).catch(() => {
      // Wallet may already exist or creation temporarily unavailable — safe to ignore
    });
  }, [authenticated, ready, stellarWallet, createWallet]);

  // Balance helpers
  const refreshBalances = useCallback(async () => {
    if (!address) return;
    const xlm = await getXlmBalance(address);
    setXlmBalance(xlm);
    if (USDC_TOKEN_ADDRESS) {
      const usdc = await getTokenBalance(USDC_TOKEN_ADDRESS, address);
      setUsdcBalance(formatAmount(usdc));
    }
  }, [address]);

  // Auto-refresh every 15 s while connected
  useEffect(() => {
    if (!isConnected || !address) return;
    refreshBalances();
    const interval = setInterval(refreshBalances, 15_000);
    return () => clearInterval(interval);
  }, [isConnected, address, refreshBalances]);

  // connect() is a no-op for the Privy path — login is triggered externally via privyLogin()
  const connect = useCallback(async () => {}, []);

  const disconnect = useCallback(async () => {
    try { await logout(); } catch { /* ignore */ }
    setXlmBalance('0');
    setUsdcBalance('0');
  }, [logout]);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!stellarWallet) throw new Error('No Privy Stellar wallet connected.');

      // Cast needed: getStellarTxHash returns string, but signRawHash requires `0x${string}`
      const hash = getStellarTxHash(xdr) as `0x${string}`;

      const { signature } = await signRawHash({
        address: stellarWallet.address,
        chainType: 'stellar',
        hash,
      });

      return assembleStellarSignedTx(xdr, stellarWallet.address, signature);
    },
    [stellarWallet, signRawHash]
  );

  return {
    address,
    isConnected,
    xlmBalance,
    usdcBalance,
    networkWarning,
    connect,
    disconnect,
    refreshBalances,
    signTransaction,
    isPrivyReady: ready,
    privyLogin: login,
  };
}
