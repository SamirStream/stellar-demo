import { useState, useCallback, useContext, createContext, useRef, useEffect } from 'react';
import { 
  Award, FileText, 
  Zap, ArrowRightLeft,
  Coins, Plus,
  Network, Cpu, Lock,
  TerminalSquare
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
        Initialize Terminal
      </Button>
      <a href="https://thesignal.directory" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
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
                <nav className="hidden lg:flex gap-1 bg-[#09090b] p-1.5 rounded-2xl border border-zinc-800/80 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 overflow-hidden ${
                        activeTab === tab.id 
                          ? 'text-[#02040a]' 
                          : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'
                      }`}
                    >
                      {activeTab === tab.id && (
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-green-400 shadow-[0_0_20px_rgba(16,185,129,0.5)] z-0"></div>
                      )}
                      <tab.icon size={16} className={`relative z-10`} />
                      <span className="relative z-10">{tab.label}</span>
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
                 <a href="https://x.com/thesignaldir" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg">X</a>
                 <a href="https://www.linkedin.com/company/signaldirectory/" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg">IN</a>
                 <a href="https://t.me/thesignaldirectory" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg">TG</a>
                 <a href="https://discord.gg/DyMtfph9rA" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors p-2 bg-zinc-900 rounded-lg">DC</a>
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
