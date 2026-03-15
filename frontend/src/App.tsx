import { useState, useCallback, useContext, createContext, useRef, useEffect } from 'react';
import {
  Award, FileText,
  Zap, ArrowRightLeft,
  Coins, Plus,
  Network, Cpu, Lock,
  TerminalSquare, Activity
} from 'lucide-react';
import { useStellarWallet } from './hooks/useStellarWallet';
import { useDealEscrow } from './hooks/useDealEscrow';
import { ConnectWallet } from './components/ConnectWallet';
import { CreateDeal } from './components/CreateDeal';
import { DealDashboard } from './components/DealDashboard';
import { SoroswapWidget } from './components/SoroswapWidget';
import { ReputationBadge } from './components/ReputationBadge';
import { DEAL_ESCROW_CONTRACT, getExplorerContractLink } from './lib/stellar';
import { SignalLogo, GlowingBackground } from './components/ui/Branding';
import { Button, Card } from './components/ui/Components';

/* ============================================
   Toast Notification System
   ============================================ */
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType; exiting?: boolean }

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});
export const useToast = () => useContext(ToastContext);

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  // Keeping the simplified inline toast for now, can map to Tailwind later if needed.
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-md transition-all duration-300 ${
          t.exiting ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
        } ${
          t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
          t.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
          'bg-zinc-800/80 border-zinc-700 text-zinc-300'
        }`} onClick={() => onDismiss(t.id)}>
          <span className="font-bold">
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✕'}
            {t.type === 'info' && 'ℹ'}
          </span>
          <span className="text-sm font-medium">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================
   Live Network Ticker
   ============================================ */
const TICKER_ITEMS = [
  { hash: 'A3F7C2B1', amount: 25000, type: 'ESCROW_LOCK' },
  { hash: 'D9E4A812', amount: 8500,  type: 'MILESTONE_RELEASE' },
  { hash: 'F1B2C394', amount: 42000, type: 'FEE_SPLIT' },
  { hash: 'C7A8D561', amount: 15750, type: 'ESCROW_LOCK' },
  { hash: 'E2F9B034', amount: 33200, type: 'MILESTONE_RELEASE' },
  { hash: 'B4C1A723', amount: 9800,  type: 'FEE_SPLIT' },
  { hash: 'A9F3C8E1', amount: 67500, type: 'ESCROW_LOCK' },
  { hash: 'D5B2A490', amount: 21000, type: 'MILESTONE_RELEASE' },
];

function LiveTicker() {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="w-full bg-[#050505] border-b border-zinc-900 flex items-center h-9 overflow-hidden text-[10px] font-mono font-bold uppercase tracking-widest relative z-40">
      <div className="bg-emerald-500 text-[#010205] h-full px-4 flex items-center justify-center shrink-0 shadow-[10px_0_20px_rgba(0,0,0,0.9)]">
        <Activity size={11} className="mr-2 animate-pulse" />
        Live Network
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex whitespace-nowrap animate-marquee w-max">
          {doubled.map((item, i) => (
            <div key={i} className="flex items-center gap-5 px-6 text-zinc-600">
              <span className="text-zinc-700">TX_{item.hash}</span>
              <span className={item.type === 'MILESTONE_RELEASE' ? 'text-emerald-400' : 'text-zinc-500'}>
                {item.type}
              </span>
              <span className="text-zinc-400">{item.amount.toLocaleString()} XLM</span>
              <span className="text-zinc-800">·</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type Tab = 'create' | 'dashboard' | 'fund' | 'reputation';

const tabs: { id: Tab; label: string; icon: any }[] = [
  { id: 'fund', label: 'Liquidity', icon: Coins },
  { id: 'create', label: 'Deploy Contract', icon: Plus },
  { id: 'dashboard', label: 'Terminal', icon: TerminalSquare },
  { id: 'reputation', label: 'Oracle', icon: Award },
];

// --- 1. Landing Page View (Replaces connect-prompt) ---
// Note: Kept the onConnect prop slightly different as it handles the logic
const LandingView = ({ onConnect }: { onConnect: () => void }) => (
  <div className="flex flex-col items-center justify-center min-h-[85vh] text-center px-4 animate-fade-in relative z-10 pt-10">
    <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-zinc-900/50 border border-emerald-500/20 text-emerald-400 mb-10 backdrop-blur-md shadow-[0_0_20px_rgba(16,185,129,0.1)] hover:border-emerald-500/50 transition-colors cursor-default">
      <span className="relative flex h-3 w-3 mr-1">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
      </span>
      <span className="text-sm font-bold tracking-widest uppercase">Soroban Testnet Live</span>
    </div>
    
    <h1 className="text-6xl md:text-8xl font-black text-white mb-8 tracking-tighter leading-[1.1]">
      Programmable <br /> 
      <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-green-400 to-emerald-200 drop-shadow-[0_0_30px_rgba(52,211,153,0.4)]">
        Trust Layer
      </span>
    </h1>
    
    <p className="text-xl text-zinc-400 max-w-3xl mb-14 leading-relaxed font-light">
      Execute complex multi-party agreements with atomic fee routing, milestone locks, and cryptographically verified reputation. <span className="text-white font-medium">Code is the new law.</span>
    </p>

    <div className="flex flex-col sm:flex-row gap-6 mb-32">
      <Button onClick={onConnect} variant="primary" className="text-lg px-10 py-5 w-full sm:w-auto" icon={TerminalSquare}>
        Connect Wallet
      </Button>
      <a href="https://github.com/SamirStream/stellar-demo" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
        <Button variant="secondary" className="text-lg px-10 py-5 w-full h-full" icon={FileText}>
          Read Documentation
        </Button>
      </a>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 w-full max-w-7xl relative">
      <div className="hidden md:block absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent -translate-y-1/2 z-0"></div>
      
      {[
        { icon: Lock, title: "Milestone Vaults", desc: "Funds cryptographically locked until off-chain validation.", color: "text-emerald-400" },
        { icon: Network, title: "Atomic Routing", desc: "Provider & BD paid in a single, indivisible ledger transaction.", color: "text-emerald-300" },
        { icon: Cpu, title: "On-Chain Memory", desc: "Immutable reputation generated by Soroban smart contracts.", color: "text-green-400" },
        { icon: ArrowRightLeft, title: "Native Swaps", desc: "Integrated liquidity pools via Soroswap protocol.", color: "text-emerald-500" }
      ].map((feature, idx) => (
        <Card key={idx} className="p-8 text-left z-10 bg-[#09090b] shadow-xl" hoverEffect glowOnHover>
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]">
            <feature.icon size={28} className={feature.color} />
          </div>
          <h3 className="text-xl font-bold text-white mb-3 tracking-tight">{feature.title}</h3>
          <p className="text-zinc-400 text-sm leading-relaxed font-medium">{feature.desc}</p>
        </Card>
      ))}
    </div>
  </div>
);


export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
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
    setTimeout(() => setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t)), 2700);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
  }, []);

  const handleDealCreated = useCallback((dealId: number) => {
    setLastCreatedDealId(dealId);
    setActiveTab('dashboard');
  }, []);

  const handleFundComplete = useCallback(() => {
    setActiveTab('create');
  }, []);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    localStorage.setItem('parity-banner-dismissed', '1');
  }, []);

  // Keyboard tab navigation (Alt+1/2/3/4)
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

  // Truncate wallet logic
  const truncWallet = wallet.address ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}` : '';

  return (
    <ToastContext.Provider value={toast}>
      <div className="min-h-screen bg-[#02040a] text-zinc-200 selection:bg-emerald-500/30 overflow-x-hidden relative flex flex-col">
        <GlowingBackground />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />

        {/* Live Ticker */}
        <LiveTicker />

        {/* Header */}
        <header className="relative z-50 border-b border-zinc-800/80 bg-[#02040a]/80 backdrop-blur-2xl sticky top-0">
          <div className="max-w-[90rem] mx-auto px-6 h-24 flex items-center justify-between">
            {/* Logo */}
            <a href="https://thesignal.directory" target="_blank" rel="noopener noreferrer" className="flex items-center gap-5 cursor-pointer group">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-500 blur-lg opacity-40 group-hover:opacity-80 transition-opacity"></div>
                <SignalLogo className="w-12 h-12 relative z-10" />
              </div>
              <div className="flex flex-col">
                <span className="text-3xl font-black tracking-tighter text-white group-hover:text-emerald-400 transition-colors">THE SIGNAL</span>
                <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.3em]">Decentralized Escrow</span>
              </div>
            </a>

            {/* Navigation / Wallet Connect */}
            {wallet.isConnected ? (
              <div className="flex items-center gap-8">
                {/* Tabs */}
                <nav className="hidden lg:flex gap-2">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300 border ${
                        activeTab === tab.id
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-[inset_0_0_20px_rgba(74,222,128,0.05)]'
                          : 'text-zinc-500 hover:text-white border-transparent hover:bg-zinc-900/60'
                      }`}
                    >
                      <tab.icon size={14} />
                      {tab.label}
                    </button>
                  ))}
                </nav>
                
                {/* Connected Wallet Info */}
                <div className="flex items-center gap-4 bg-[#09090b] border border-zinc-800/80 rounded-2xl pl-5 pr-1.5 py-1.5 shadow-xl">
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-mono text-emerald-400 font-bold">{wallet.xlmBalance} XLM</span>
                    <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Testnet</span>
                  </div>
                  {/* Keep wallet.disconnect bound to this click or add a dropdown eventually, for now just click to disconnect */}
                  <div onClick={wallet.disconnect} title="Click to disconnect" className="bg-[#02040a] text-emerald-100 text-xs font-mono font-bold px-4 py-3 rounded-xl border border-zinc-800 hover:border-red-500/50 hover:text-red-400 cursor-pointer transition-all shadow-[inset_0_0_10px_rgba(16,185,129,0.05)] flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                    {truncWallet}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                 <ConnectWallet wallet={wallet} />
              </div>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="relative z-10 max-w-[90rem] mx-auto px-6 py-12 flex-1 w-full">
          {!wallet.isConnected ? (
            <LandingView onConnect={wallet.connect} />
          ) : (
            <div className="min-h-[70vh]">
              {/* Production Parity Banner - Styled for new design */}
              {!bannerDismissed && (
                <div className="mb-10 p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 to-transparent border border-emerald-500/20 flex justify-between items-start relative overflow-hidden group">
                   <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
                  <div>
                    <h4 className="text-emerald-400 font-bold uppercase tracking-widest text-xs mb-2 flex items-center gap-2">
                      <Zap size={14}/> Production Parity Demo
                    </h4>
                    <p className="text-sm text-zinc-400">
                      Replicates live logic on Soroban: 3-party protocol split, milestone locks, and immutable reputation.
                    </p>
                  </div>
                  <button onClick={dismissBanner} className="text-zinc-500 hover:text-white p-2">✕</button>
                </div>
              )}

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
          )}
        </main>

        {/* Footer */}
        <footer className="relative z-10 border-t border-zinc-800/80 py-10 bg-[#02040a]/90 backdrop-blur-xl mt-auto">
          <div className="max-w-[90rem] mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-10 opacity-80 hover:opacity-100 transition-opacity">
            {/* Left */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <SignalLogo className="w-8 h-8 grayscale opacity-70" />
                <div>
                  <span className="block font-bold text-sm text-white">The Signal</span>
                  <span className="block text-xs text-zinc-500">Trustless Escrow</span>
                </div>
              </div>
              <p className="text-xs text-zinc-500 max-w-xs">
                &copy; {new Date().getFullYear()} The Signal. All rights reserved.
              </p>
            </div>

            {/* Middle Links */}
            <div className="flex gap-16 justify-center text-sm">
              <div className="flex flex-col gap-3">
                <span className="font-bold text-zinc-400 uppercase tracking-widest text-[10px]">Protocol</span>
                {DEAL_ESCROW_CONTRACT && (
                  <a href={getExplorerContractLink(DEAL_ESCROW_CONTRACT)} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors">
                    Smart Contract
                  </a>
                )}
                <a href="https://stellar.expert/explorer/testnet" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors">
                  Stellar Explorer
                </a>
              </div>
              <div className="flex flex-col gap-3">
                 <span className="font-bold text-zinc-400 uppercase tracking-widest text-[10px]">Ecosystem</span>
                 <a href="https://thesignal.directory" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors">Directory</a>
                 <a href="https://soroban.stellar.org" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors">Soroban Docs</a>
              </div>
            </div>

            {/* Right Socials */}
            <div className="flex flex-col items-end gap-6 justify-center md:items-end">
              <div className="flex gap-4">
                <a href="https://x.com/thesignaldir" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg" aria-label="X (Twitter)">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a href="https://www.linkedin.com/company/signaldirectory/" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg" aria-label="LinkedIn">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <a href="https://t.me/thesignaldirectory" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg" aria-label="Telegram">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                </a>
                <a href="https://discord.gg/DyMtfph9rA" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg" aria-label="Discord">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.105 18.101.12 18.14.143 18.17a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                </a>
              </div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest font-mono flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                Powered by Soroban Network
              </div>
            </div>
          </div>
        </footer>
      </div>
    </ToastContext.Provider>
  );
}
