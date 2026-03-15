import { useState, useCallback, useContext, createContext, useRef, useEffect, type ReactNode } from 'react';
import { useStellarWallet } from './hooks/useStellarWallet';
import { useDealEscrow } from './hooks/useDealEscrow';
import { ConnectWallet } from './components/ConnectWallet';
import { CreateDeal } from './components/CreateDeal';
import { DealDashboard } from './components/DealDashboard';
import { SoroswapWidget } from './components/SoroswapWidget';
import { ReputationBadge } from './components/ReputationBadge';
import { DEAL_ESCROW_CONTRACT, getExplorerContractLink } from './lib/stellar';
import './App.css';

/* ============================================
   Toast Notification System
   ============================================ */
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType; exiting?: boolean }

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});
export const useToast = () => useContext(ToastContext);

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}${t.exiting ? ' toast-exit' : ''}`} onClick={() => onDismiss(t.id)}>
          <span className="toast-icon">
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✕'}
            {t.type === 'info' && 'ℹ'}
          </span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

type Tab = 'create' | 'dashboard' | 'fund' | 'reputation';

// Inline SVG icons for tabs
const TabIcons: Record<Tab, ReactNode> = {
  fund: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 7l-5-5-5 5" />
      <path d="M2 17h20" />
    </svg>
  ),
  create: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  reputation: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'fund', label: 'Fund Wallet' },
  { id: 'create', label: 'Create Deal' },
  { id: 'dashboard', label: 'My Deals' },
  { id: 'reputation', label: 'Reputation' },
];

const STEP_LABELS: Record<Tab, string> = {
  fund: 'Step 1',
  create: 'Step 2',
  dashboard: 'Step 3',
  reputation: 'Step 4',
};

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('fund');
  const [lastCreatedDealId, setLastCreatedDealId] = useState<number | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem('parity-banner-dismissed') === '1'
  );
  const wallet = useStellarWallet();
  const escrow = useDealEscrow(wallet.address, wallet.signTransaction);

  // Toast system
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]); // Max 3 toasts
    // Start exit animation after 2.7s, remove after 3s
    setTimeout(() => setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t)), 2700);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
  }, []);

  // After deal creation: auto-navigate to dashboard with the new deal ID
  const handleDealCreated = useCallback((dealId: number) => {
    setLastCreatedDealId(dealId);
    setActiveTab('dashboard');
  }, []);

  // After funding: navigate to create deal
  const handleFundComplete = useCallback(() => {
    setActiveTab('create');
  }, []);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    localStorage.setItem('parity-banner-dismissed', '1');
  }, []);

  // C1: Scroll-reactive header
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // C4: Keyboard tab navigation (Alt+1/2/3/4)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const tabMap: Record<string, Tab> = { '1': 'fund', '2': 'create', '3': 'dashboard', '4': 'reputation' };
      const tab = tabMap[e.key];
      if (tab && wallet.isConnected) {
        e.preventDefault();
        setActiveTab(tab);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [wallet.isConnected]);

  return (
    <ToastContext.Provider value={toast}>
    <div className="app">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {/* Header */}
      <header className={`app-header${scrolled ? ' header-scrolled' : ''}`}>
        <div className="header-left">
          <a href="https://thesignal.directory" target="_blank" rel="noopener noreferrer" className="logo">
            <img src="/logo.png" alt="The Signal" className="logo-img" />
            <div className="logo-text">
              <span className="logo-title">The Signal</span>
              <span className="logo-subtitle">Stellar Escrow Demo</span>
            </div>
          </a>
        </div>
        <div className="header-right">
          <span className="testnet-badge">TESTNET</span>
          <ConnectWallet wallet={wallet} />
        </div>
      </header>

      {/* Main Content */}
      <main className={`app-main${activeTab === 'dashboard' && wallet.isConnected ? ' app-main-wide' : ''}`}>
        {!wallet.isConnected ? (
          <div className="connect-prompt">
            <div className="connect-prompt-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <h2>Connect Your Wallet</h2>
            <p>
              Connect a Stellar wallet (Freighter, xBull, or Albedo) to interact
              with the DealEscrow smart contract on Testnet.
            </p>
            <button onClick={wallet.connect} className="btn-primary btn-large">
              <span className="btn-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M22 10H2" />
                  <circle cx="16" cy="14" r="2" />
                </svg>
              </span>
              Connect Wallet
            </button>
            <div className="connect-features">
              <div className="feature animate-in">
                <span className="feature-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                  </svg>
                </span>
                <span>Milestone-Based Escrow</span>
              </div>
              <div className="feature animate-in">
                <span className="feature-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M16 8l-4 4-4-4" />
                    <path d="M8 16l4-4 4 4" />
                  </svg>
                </span>
                <span>Atomic 3-Way Splits</span>
              </div>
              <div className="feature animate-in">
                <span className="feature-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </span>
                <span>On-Chain Reputation</span>
              </div>
              <div className="feature animate-in">
                <span className="feature-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                    <polyline points="17 6 23 6 23 12" />
                  </svg>
                </span>
                <span>Soroswap Integration</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Tabs with step indicators */}
            <nav className="tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                >
                  <span className="tab-step">{STEP_LABELS[tab.id]}</span>
                  <span className="tab-icon">{TabIcons[tab.id]}</span>
                  <span className="tab-label">{tab.label}</span>
                </button>
              ))}
            </nav>

            {/* Production Parity Banner */}
            {!bannerDismissed && (
              <div className="parity-banner">
                <div className="parity-banner-content">
                  <strong>Production Parity Demo</strong>
                  <p>This demo replicates The Signal's live escrow system on Soroban:</p>
                  <ul>
                    <li>Same 3-party split logic (Provider / Connector / Protocol)</li>
                    <li>Same milestone lifecycle (Pending → Funded → Released)</li>
                    <li>Same on-chain reputation tracking</li>
                  </ul>
                </div>
                <button type="button" onClick={dismissBanner} className="parity-banner-dismiss" aria-label="Dismiss">
                  &times;
                </button>
              </div>
            )}

            {/* Tab Content */}
            <div className="tab-content" key={activeTab}>
              {activeTab === 'fund' && (
                <SoroswapWidget
                  walletAddress={wallet.address}
                  signTransaction={wallet.signTransaction}
                  onSwapComplete={() => wallet.refreshBalances()}
                  onFundComplete={handleFundComplete}
                  onBalanceRefresh={() => wallet.refreshBalances()}
                  xlmBalance={wallet.xlmBalance}
                />
              )}

              {activeTab === 'create' && (
                <CreateDeal
                  onCreateDeal={escrow.createDeal}
                  onDealCreated={handleDealCreated}
                />
              )}

              {activeTab === 'dashboard' && (
                <DealDashboard
                  getDeal={escrow.getDeal}
                  getDealCount={escrow.getDealCount}
                  onDeposit={escrow.deposit}
                  onRelease={escrow.releaseMilestone}
                  onDispute={escrow.dispute}
                  onResolveDispute={escrow.resolveDispute}
                  walletAddress={wallet.address}
                  xlmBalance={wallet.xlmBalance}
                  initialDealId={lastCreatedDealId}
                  onNavigateToCreate={() => setActiveTab('create')}
                  onNavigateToFund={() => setActiveTab('fund')}
                />
              )}

              {activeTab === 'reputation' && (
                <ReputationBadge
                  getReputation={escrow.getReputation}
                  getDealCount={escrow.getDealCount}
                  getDeal={escrow.getDeal}
                  walletAddress={wallet.address}
                />
              )}
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <img src="/logo.png" alt="The Signal" className="footer-logo" />
            <div>
              <span className="footer-brand-name">The Signal</span>
              <span className="footer-brand-tagline">Trustless Escrow for the Open Economy</span>
            </div>
          </div>
          <div className="footer-socials">
            <a href="https://thesignal.directory" target="_blank" rel="noopener noreferrer" title="Website" aria-label="Website">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </a>
            <a href="https://x.com/thesignaldir" target="_blank" rel="noopener noreferrer" title="X (Twitter)" aria-label="X (Twitter)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a href="https://www.linkedin.com/company/signaldirectory/" target="_blank" rel="noopener noreferrer" title="LinkedIn" aria-label="LinkedIn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
            <a href="https://discord.gg/DyMtfph9rA" target="_blank" rel="noopener noreferrer" title="Discord" aria-label="Discord">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </a>
            <a href="https://t.me/thesignaldirectory" target="_blank" rel="noopener noreferrer" title="Telegram" aria-label="Telegram">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </a>
            <a href="mailto:support@thesignal.directory" title="Email" aria-label="Email">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 7l-10 7L2 7" />
              </svg>
            </a>
          </div>
        </div>
        <div className="footer-middle">
          <div className="footer-links-group">
            <span className="footer-links-title">Protocol</span>
            {DEAL_ESCROW_CONTRACT && (
              <a href={getExplorerContractLink(DEAL_ESCROW_CONTRACT)} target="_blank" rel="noopener noreferrer">
                Smart Contract
              </a>
            )}
            <a href="https://stellar.expert/explorer/testnet" target="_blank" rel="noopener noreferrer">
              Stellar Explorer
            </a>
            <a href="https://soroban.stellar.org" target="_blank" rel="noopener noreferrer">
              Soroban Docs
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="footer-copyright">&copy; {new Date().getFullYear()} The Signal. All rights reserved.</span>
          <span className="footer-powered">
            Powered by
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Stellar &amp; Soroban
          </span>
        </div>
      </footer>
    </div>
    </ToastContext.Provider>
  );
}

export default App;
