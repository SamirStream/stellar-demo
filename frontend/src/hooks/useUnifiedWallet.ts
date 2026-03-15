/**
 * useUnifiedWallet.ts
 *
 * Single hook that merges the Privy embedded wallet path and the
 * StellarWalletsKit (Freighter / Albedo) path into one WalletState.
 *
 * Priority: Privy > StellarWalletsKit.
 * All consumers of this hook (App, DealDashboard, etc.) keep working
 * without modification because the returned interface is identical to
 * the original WalletState from useStellarWallet.
 */
import { useStellarWallet } from './useStellarWallet';
import { usePrivyWallet } from './usePrivyWallet';
import type { WalletState } from './useStellarWallet';

export type WalletSource = 'privy' | 'swk' | null;

export interface UnifiedWalletState extends WalletState {
  /** Which wallet source is currently active */
  activeSource: WalletSource;
  /** Opens Privy's login modal (email / social) */
  privyLogin: () => void;
  /** Opens StellarWalletsKit's auth modal (Freighter / Albedo) */
  swkConnect: () => Promise<void>;
  /** true while Privy auth is complete but Stellar wallet is still being created */
  isWalletLoading: boolean;
}

export function useUnifiedWallet(): UnifiedWalletState {
  const swk = useStellarWallet();
  const privy = usePrivyWallet();

  // Privy takes priority; fall back to SWK
  const activeSource: WalletSource = privy.isConnected
    ? 'privy'
    : swk.isConnected
    ? 'swk'
    : null;

  const active: WalletState = activeSource === 'privy' ? privy : swk;

  return {
    ...active,
    activeSource,
    privyLogin: privy.privyLogin,
    swkConnect: swk.connect,
    isWalletLoading: privy.isWalletLoading,
  };
}
