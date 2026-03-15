import { useState, useEffect, useCallback, useRef } from 'react';
import {
  StellarWalletsKit,
  Networks,
  KitEventType,
} from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
// xBullModule removed: xBull always reports isAvailable=true but its web popup
// (wallet.xbull.app/connect) is blocked by Firefox popup blocker when opened
// from an async context, causing silent "nothing happens" with no error feedback.
import { getXlmBalance, getTokenBalance, formatAmount, USDC_TOKEN_ADDRESS, NETWORK_PASSPHRASE } from '../lib/stellar';

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
  networkWarning: string | null;
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
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);
  const initialized = useRef(false);

  // Initialize the wallet kit once
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    StellarWalletsKit.init({
      network: Networks.TESTNET,
      modules: [
        // Albedo first: web-based, no extension, no popup blocker issues
        new AlbedoModule(),
        // Freighter second: extension wallet, shown for users who have it installed
        freighterModule,
      ],
    });

    // Pre-warm Freighter detection so the cache is populated before the user
    // clicks Connect Wallet. Avoids the 2s timeout race on first open.
    freighterModule.isAvailable().catch(() => {});

    // Capture the selected module ID when the user picks a wallet in the modal.
    // KitEventWalletSelected payload shape: { id: string | undefined }
    // Stored in sessionStorage temporarily so connect() can persist it to localStorage.
    StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (event) => {
      if (event.payload.id) sessionStorage.setItem('swk_module_id', event.payload.id);
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

    // Try to restore a previous session (async — must not block init)
    ;(async () => {
      try {
        const stored = localStorage.getItem('swk_session');
        if (!stored) {
          // No custom session yet. The kit's STATE_UPDATED already restored the address.
          // However, the kit's stored selectedModuleId may be stale (e.g. 'albedo' from a
          // previous test session) while activeAddress belongs to a Freighter account.
          // If Freighter is available and owns the kit's stored address, correct the module
          // and call requestAccess() to authorise signing for this browser session.
          const kitAddress = localStorage.getItem('@StellarWalletsKit/activeAddress');
          if (!kitAddress) return;

          const freighterAvail = await freighterModule.isAvailable().catch(() => false);
          if (freighterAvail) {
            try {
              // requestAccess() has no built-in timeout — race against 5 s
              const getAddrPromise = freighterModule.getAddress({});
              const timeoutPromise = new Promise<never>((_, rej) =>
                setTimeout(() => rej(new Error('__timeout__')), 5_000)
              );
              const { address: freighterAddr } = await Promise.race([getAddrPromise, timeoutPromise]);
              if (freighterAddr === kitAddress) {
                // Freighter owns this address — prefer it over the stale kit module
                StellarWalletsKit.setWallet(freighterModule.productId);
                localStorage.setItem('swk_session', JSON.stringify({ address: freighterAddr, moduleId: freighterModule.productId }));
                return; // module corrected, session saved for next load
              }
            } catch { /* timeout, requestAccess denied, or different account — fall through */ }
          }

          // Freighter unavailable or different account: explicitly bind kit's stored module
          // so the selection is current and consistent with what STATE_UPDATED displayed.
          const kitModuleId = localStorage.getItem('@StellarWalletsKit/selectedModuleId');
          if (kitModuleId) {
            try { StellarWalletsKit.setWallet(kitModuleId); } catch { /* unknown module */ }
          }
          return;
        }

        const { address: storedAddress, moduleId } = JSON.parse(stored) as { address: string; moduleId: string };
        if (!storedAddress || !moduleId) { localStorage.removeItem('swk_session'); return; }

        // Restore the wallet module and verify the address still matches.
        StellarWalletsKit.setWallet(moduleId);
        // For Freighter: call the actual module's getAddress() to trigger requestAccess()
        // silently (no popup if already authorised). This ensures Freighter allows signing
        // in this browser session even though authModal() was not called on this page load.
        // For other wallets (Albedo etc.): read from kit memory — calling their getAddress()
        // would open a web popup on every page reload, which is unwanted.
        const { address: restoredAddress } = moduleId === freighterModule.productId
          ? await StellarWalletsKit.selectedModule.getAddress()
          : await StellarWalletsKit.getAddress();
        if (restoredAddress === storedAddress) {
          setAddress(restoredAddress);
          setIsConnected(true);
        } else {
          localStorage.removeItem('swk_session');
        }
      } catch {
        // Session restoration failed (extension locked, module unavailable, etc.)
        localStorage.removeItem('swk_session');
      }
    })();
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

    // Persist session so the wallet stays connected across page reloads.
    // moduleId was captured by the WALLET_SELECTED event listener during authModal().
    const moduleId = sessionStorage.getItem('swk_module_id') || '';
    localStorage.setItem('swk_session', JSON.stringify({ address: walletAddress, moduleId }));

    // Validate that the connected wallet is on the expected network.
    // getNetwork() is only supported by extension wallets (Freighter); Albedo silently returns
    // the kit's configured network, so mismatches are only possible with extension wallets.
    try {
      const net = await StellarWalletsKit.getNetwork();
      if (net?.networkPassphrase && net.networkPassphrase !== NETWORK_PASSPHRASE) {
        const name = net.networkPassphrase.includes('Public') ? 'Mainnet' : 'an unknown network';
        setNetworkWarning(`Wrong network: your wallet is connected to ${name}. Switch to Testnet in your wallet settings.`);
      } else {
        setNetworkWarning(null);
      }
    } catch {
      // getNetwork() is not supported by all wallet modules — fail silently.
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
    setNetworkWarning(null);
    localStorage.removeItem('swk_session');
    sessionStorage.removeItem('swk_module_id');
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
    networkWarning,
    connect,
    disconnect,
    refreshBalances,
    signTransaction,
  };
}
