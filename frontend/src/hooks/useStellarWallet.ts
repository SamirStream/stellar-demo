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
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule(),
      ],
    });

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

  // Connect wallet via auth modal
  const connect = useCallback(async () => {
    try {
      const { address: walletAddress } = await StellarWalletsKit.authModal();
      setAddress(walletAddress);
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
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

  // Sign a transaction with error categorization
  const signTransaction = useCallback(
    async (xdr: string, opts?: any): Promise<string> => {
      try {
        const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, opts);
        return signedTxXdr;
      } catch (err: any) {
        const msg = (err?.message || '').toLowerCase();
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
