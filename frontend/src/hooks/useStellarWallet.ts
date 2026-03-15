import { useState, useEffect, useCallback, useRef } from 'react';
import {
  StellarWalletsKit,
  Networks,
  KitEventType,
} from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { getXlmBalance, getTokenBalance, formatAmount, USDC_TOKEN_ADDRESS } from '../lib/stellar';

// FreighterModule detection uses window.postMessage with a 2s timeout.
// If the extension content script hasn't injected yet when the modal opens,
// it times out and shows "Install". Fix: cache the detection result so
// pre-warming on mount prevents the race condition on first click.
class CachedFreighterModule extends FreighterModule {
  private _cached: Promise<boolean> | null = null;

  async isAvailable(): Promise<boolean> {
    if (!this._cached) {
      this._cached = super.isAvailable().then((result) => {
        if (!result) this._cached = null; // retry if false (not yet injected)
        return result;
      }).catch(() => {
        this._cached = null;
        return false;
      });
    }
    return this._cached;
  }
}

// Module-level singleton so cache persists across re-renders
const freighterModule = new CachedFreighterModule();

export interface WalletState {
  address: string;
  isConnected: boolean;
  xlmBalance: string;
  usdcBalance: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  signTransaction: (xdr: string, opts?: any) => Promise<string>;
}

export function useStellarWallet(): WalletState {
  const [address, setAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [xlmBalance, setXlmBalance] = useState('0');
  const [usdcBalance, setUsdcBalance] = useState('0');
  const initialized = useRef(false);

  // Initialize the wallet kit once
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    StellarWalletsKit.init({
      network: Networks.TESTNET,
      modules: [
        freighterModule,
        new xBullModule(),
        new AlbedoModule(),
      ],
    });

    // Pre-warm Freighter detection so the cache is populated before the user
    // clicks Connect Wallet. Avoids the 2s timeout race on first open.
    freighterModule.isAvailable().catch(() => {});

    // Listen for state updates (e.g. user changes wallet address)
    StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
      if (event.payload.address) {
        setAddress(event.payload.address);
        setIsConnected(true);
      }
    });

    StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
      setAddress('');
      setIsConnected(false);
      setXlmBalance('0');
      setUsdcBalance('0');
    });
  }, []);

  // Refresh balances
  const refreshBalances = useCallback(async () => {
    if (!address) return;
    const xlm = await getXlmBalance(address);
    setXlmBalance(xlm);

    if (USDC_TOKEN_ADDRESS) {
      const usdc = await getTokenBalance(USDC_TOKEN_ADDRESS, address);
      setUsdcBalance(formatAmount(usdc));
    }
  }, [address]);

  // Auto-refresh balances when connected (ref-based to avoid interval restarts)
  const refreshRef = useRef(refreshBalances);
  refreshRef.current = refreshBalances;

  useEffect(() => {
    if (isConnected && address) {
      refreshRef.current();
      const interval = setInterval(() => refreshRef.current(), 15000);
      return () => clearInterval(interval);
    }
  }, [isConnected, address]);

  // Connect wallet via auth modal.
  // authModal() → FreighterModule.getAddress() → requestAccess() has no
  // built-in timeout in @stellar/freighter-api. If the Freighter popup fails
  // to open (Firefox extension bug), the promise hangs forever with no feedback.
  // We add a 60s timeout and re-throw so callers can show a useful error.
  const connect = useCallback(async () => {
    const CONNECT_TIMEOUT_MS = 60_000;
    const connectPromise = StellarWalletsKit.authModal();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('__connect_timeout__')), CONNECT_TIMEOUT_MS)
    );
    const { address: walletAddress } = await Promise.race([connectPromise, timeoutPromise]);
    setAddress(walletAddress);
    setIsConnected(true);
  }, []);

  // Disconnect wallet
  const disconnect = useCallback(async () => {
    try {
      await StellarWalletsKit.disconnect();
    } catch {
      // ignore
    }
    setAddress('');
    setIsConnected(false);
    setXlmBalance('0');
    setUsdcBalance('0');
  }, []);

  // Sign a transaction with error categorization and timeout guard.
  // Freighter's SUBMIT_TRANSACTION postMessage has no built-in timeout.
  // xBull opens window.open() popup — if Firefox blocks it the promise
  // hangs forever. We race against a 120s timeout so the UI never stalls.
  const signTransaction = useCallback(
    async (xdr: string, opts?: any): Promise<string> => {
      const SIGN_TIMEOUT_MS = 120_000;
      try {
        const signPromise = StellarWalletsKit.signTransaction(xdr, opts);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('__timeout__')),
            SIGN_TIMEOUT_MS
          )
        );
        const { signedTxXdr } = await Promise.race([signPromise, timeoutPromise]);
        return signedTxXdr;
      } catch (err: any) {
        const msg = (err?.message || '').toLowerCase();
        if (msg === '__timeout__') {
          throw new Error(
            'Wallet signing timed out. If a popup opened, make sure popups are allowed for this page, then try again.'
          );
        }
        if (msg.includes('cancel') || msg.includes('reject') || msg.includes('denied') || msg.includes('user')) {
          throw new Error('Transaction cancelled by user.');
        }
        if (msg.includes('not available') || msg.includes('not found') || msg.includes('not installed')) {
          throw new Error('Wallet not available. Please reconnect.');
        }
        throw new Error(`Signing failed: ${err?.message || 'Unknown error'}`);
      }
    },
    []
  );

  return {
    address,
    isConnected,
    xlmBalance,
    usdcBalance,
    connect,
    disconnect,
    refreshBalances,
    signTransaction,
  };
}
