import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ShieldCheck, AlertCircle, Activity, CheckCircle, Clock, Copy, Search, ArrowRight, User, Filter, RefreshCw, Plus, X
} from 'lucide-react';
import { truncateAddress, formatAmount, getExplorerTxLink, getTokenSymbol } from '../lib/stellar';
import { useToast } from '../App';
import type { DealData } from '../hooks/useDealEscrow';
import { getDealMetadata, recordMilestoneEvent, getAllDealEvents, formatEventDateTime, getEventLabel } from '../lib/dealMetadata';
import { Card, Button, Tag } from './ui/Components';

/* ============================================
   Constants & Helpers
   ============================================ */

const STATUS_COLORS: Record<string, "emerald" | "amber" | "blue" | "red" | "zinc"> = {
  Created: 'amber',
  Active: 'blue',
  Completed: 'emerald',
  Cancelled: 'red',
  Disputed: 'red',
};

const STATUS_LABELS: Record<string, string> = {
  Created: 'Awaiting Funding',
  Active: 'In Progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Disputed: 'Disputed',
};

const MILESTONE_LABELS: Record<string, string> = {
  Pending: 'Pending',
  Funded: 'Funded',
  Released: 'Released',
  Disputed: 'Disputed',
  Refunded: 'Refunded',
};

const MILESTONE_COLORS: Record<string, "emerald" | "amber" | "blue" | "red" | "zinc"> = {
  Pending: 'zinc',
  Funded: 'blue',
  Released: 'emerald',
  Disputed: 'red',
  Refunded: 'zinc',
};

function normalizeEnum(val: any): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val[0];
  return Object.keys(val)[0];
}

function getDealStatus(deal: DealData): string { return normalizeEnum(deal.status); }
function getMilestoneStatus(m: any): string { return normalizeEnum(m.status); }

function getMilestoneProgress(deal: DealData): string {
  const released = deal.milestones.filter((m) => getMilestoneStatus(m) === 'Released').length;
  return `${released}/${deal.milestones.length}`;
}

function getRole(deal: DealData, wallet: string): string | null {
  if (deal.client === wallet) return 'Client';
  if (deal.provider === wallet) return 'Provider';
  if (deal.connector === wallet) return 'Connector';
  return null;
}

function isParticipant(deal: DealData, wallet: string): boolean {
  return deal.client === wallet || deal.provider === wallet || deal.connector === wallet;
}

async function copyToClipboard(text: string, setCopied: (key: string) => void, key: string, toastFn?: (msg: string, type?: 'success'|'error'|'info') => void) {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
    toastFn?.('Copied to clipboard', 'success');
  } catch {}
}

interface DealWithId { id: number; data: DealData; }
type StatusFilter = 'all' | 'Active' | 'Created' | 'Completed' | 'Disputed' | 'Cancelled';

interface Props {
  getDeal: (dealId: number) => Promise<DealData | null>;
  getDealCount: () => Promise<number>;
  onDeposit: (dealId: number, milestoneIdx: number) => Promise<{ txHash: string }>;
  onRelease: (dealId: number, milestoneIdx: number) => Promise<{ txHash: string }>;
  onDispute: (dealId: number, milestoneIdx: number) => Promise<{ txHash: string }>;
  walletAddress: string;
  xlmBalance: string;
  initialDealId?: number | null;
  onNavigateToCreate?: () => void;
  onNavigateToFund?: () => void;
}

/* ============================================
   Main Component
   ============================================ */

export function DealDashboard({
  getDeal, getDealCount, onDeposit, onRelease, onDispute,
  walletAddress, xlmBalance, initialDealId, onNavigateToCreate, onNavigateToFund,
}: Props) {
  const toast = useToast();

  const [allDeals, setAllDeals] = useState<DealWithId[]>([]);
  const [listLoading, setListLoading] = useState(true);


  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [myDealsOnly, setMyDealsOnly] = useState(true);

  const [selectedDealId, setSelectedDealId] = useState<number | null>(initialDealId ?? null);
  const [mobileShowDetail, setMobileShowDetail] = useState(initialDealId !== null && initialDealId !== undefined);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');
  const [splitView, setSplitView] = useState<{ milestoneIdx: number; txHash: string } | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    type: 'release' | 'dispute';
    milestoneIdx: number;
  } | null>(null);

  const [copiedKey, setCopiedKey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAllDeals = useCallback(async () => {
    setListLoading(true);
    try {
      const count = await getDealCount();
      if (count === 0) {
        setAllDeals([]);
        setListLoading(false);
        return;
      }

      const dealIds = Array.from({ length: count }, (_, i) => i);
      const results = await Promise.allSettled(
        dealIds.map(async (id) => {
          const data = await getDeal(id);
          return data ? { id, data } : null;
        })
      );

      const deals: DealWithId[] = results
        .filter((r): r is PromiseFulfilledResult<DealWithId | null> => r.status === 'fulfilled' && r.value !== null)
        .map((r) => r.value!)
        .sort((a, b) => b.id - a.id);

      setAllDeals(deals);
    } catch (err: any) {
      console.error(err.message || 'Failed to fetch deals');
    } finally {
      setListLoading(false);
    }
  }, [getDeal, getDealCount]);

  useEffect(() => {
    fetchAllDeals();
  }, []);

  const fetchRef = useRef(fetchAllDeals);
  fetchRef.current = fetchAllDeals;
  useEffect(() => {
    const interval = setInterval(() => fetchRef.current(), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (initialDealId !== null && initialDealId !== undefined) {
      setSelectedDealId(initialDealId);
      setMobileShowDetail(true);
      fetchAllDeals();
    }
  }, [initialDealId]);

  const filteredDeals = useMemo(() => {
    let result = allDeals;
    if (statusFilter !== 'all') {
      result = result.filter((d) => getDealStatus(d.data) === statusFilter);
    }
    if (myDealsOnly) {
      result = result.filter((d) => isParticipant(d.data, walletAddress));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((d) => {
        const meta = getDealMetadata(d.id);
        return (
          String(d.id).includes(q) ||
          meta?.title?.toLowerCase().includes(q) ||
          d.data.client.toLowerCase().includes(q) ||
          d.data.provider.toLowerCase().includes(q) ||
          d.data.connector.toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [allDeals, statusFilter, myDealsOnly, walletAddress, searchQuery]);

  const statusCounts = useMemo(() => {
    const base = myDealsOnly ? allDeals.filter((d) => isParticipant(d.data, walletAddress)) : allDeals;
    return {
      all: base.length,
      Active: base.filter((d) => getDealStatus(d.data) === 'Active').length,
      Created: base.filter((d) => getDealStatus(d.data) === 'Created').length,
      Completed: base.filter((d) => getDealStatus(d.data) === 'Completed').length,
      Disputed: base.filter((d) => getDealStatus(d.data) === 'Disputed').length,
      Cancelled: base.filter((d) => getDealStatus(d.data) === 'Cancelled').length,
    };
  }, [allDeals, myDealsOnly, walletAddress]);

  const selectedDeal = useMemo(() => {
    if (selectedDealId === null) return null;
    return allDeals.find((d) => d.id === selectedDealId)?.data ?? null;
  }, [allDeals, selectedDealId]);

  const tokenSymbol = selectedDeal ? getTokenSymbol(selectedDeal.token) : 'TOKEN';
  const selectedStatus = selectedDeal ? getDealStatus(selectedDeal) : '';
  const selectedMeta = selectedDealId !== null ? getDealMetadata(selectedDealId) : null;

  const activityLog = useMemo(() => {
    if (selectedDealId === null || !selectedDeal) return [];
    return getAllDealEvents(selectedDealId, selectedDeal.milestones.length);
  }, [selectedDealId, selectedDeal, allDeals]);

  const computeSplit = (milestoneAmount: bigint) => {
    if (!selectedDeal) return null;
    const amount = Number(milestoneAmount);
    const platformFee = Math.floor(amount * selectedDeal.platform_fee_bps / 10000);
    const connectorCut = Math.floor(platformFee * selectedDeal.connector_share_bps / 10000);
    const protocolCut = platformFee - connectorCut;
    const providerCut = amount - platformFee;
    return { providerCut, connectorCut, protocolCut, total: amount };
  };

  const handleDeposit = async (milestoneIdx: number) => {
    if (!selectedDeal || selectedDealId === null) return;
    const milestone = selectedDeal.milestones[milestoneIdx];
    if (!milestone) return;

    const requiredAmount = Number(milestone.amount) / 1e7;
    const available = parseFloat(xlmBalance);
    if (available < requiredAmount) {
      setError(`Insufficient balance: need ${requiredAmount.toFixed(2)} XLM, have ${available.toFixed(2)} XLM.`);
      return;
    }

    setActionLoading(`deposit-${milestoneIdx}`);
    setError('');
    setSplitView(null);
    try {
      const res = await onDeposit(selectedDealId, milestoneIdx);
      setLastTxHash(res.txHash);
      recordMilestoneEvent(selectedDealId, milestoneIdx, { action: 'funded', timestamp: new Date().toISOString(), txHash: res.txHash });
      toast('Milestone funded successfully!', 'success');
      await fetchAllDeals();
    } catch (err: any) {
      setError(err.message || 'Deposit failed');
      toast('Deposit failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRelease = async (milestoneIdx: number) => {
    if (selectedDealId === null) return;
    setActionLoading(`release-${milestoneIdx}`);
    setError('');
    setConfirmAction(null);
    try {
      const res = await onRelease(selectedDealId, milestoneIdx);
      setLastTxHash(res.txHash);
      setSplitView({ milestoneIdx, txHash: res.txHash });
      const m = selectedDeal?.milestones[milestoneIdx];
      const split = m ? computeSplit(m.amount) : null;
      recordMilestoneEvent(selectedDealId, milestoneIdx, {
        action: 'released', timestamp: new Date().toISOString(), txHash: res.txHash,
        ...(split && { split: { providerAmount: split.providerCut.toString(), connectorAmount: split.connectorCut.toString(), protocolAmount: split.protocolCut.toString() } }),
      });
      toast('Milestone released — 3-way split executed!', 'success');
      await fetchAllDeals();
    } catch (err: any) {
      setError(err.message || 'Release failed');
      toast('Release failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDispute = async (milestoneIdx: number) => {
    if (selectedDealId === null) return;
    setActionLoading(`dispute-${milestoneIdx}`);
    setError('');
    setConfirmAction(null);
    try {
      const res = await onDispute(selectedDealId, milestoneIdx);
      setLastTxHash(res.txHash);
      recordMilestoneEvent(selectedDealId, milestoneIdx, { action: 'disputed', timestamp: new Date().toISOString(), txHash: res.txHash });
      toast('Dispute filed on-chain', 'info');
      await fetchAllDeals();
    } catch (err: any) {
      setError(err.message || 'Dispute failed');
      toast('Dispute failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };


  useEffect(() => {
    if (confirmAction) {
      document.body.style.overflow = 'hidden';
      const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmAction(null); };
      window.addEventListener('keydown', handleEsc);
      return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', handleEsc); };
    }
  }, [confirmAction]);

  const CopyableText = ({ text, display, label }: { text: string; display?: string; label: string }) => {
    const key = `addr-${label}`;
    const [isHovered, setIsHovered] = useState(false);
    return (
      <span
        className="inline-flex items-center gap-2 cursor-pointer text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-xs font-mono"
        onClick={() => copyToClipboard(text, setCopiedKey, key, toast)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={`Click to copy: ${text}`}
      >
        {display || truncateAddress(text)}
        {copiedKey === key ? (
          <span className="text-emerald-300 text-[10px]">Copied!</span>
        ) : (
          <Copy size={12} className={`transition-opacity ${isHovered ? 'opacity-100' : 'opacity-50'}`} />
        )}
      </span>
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 animate-fade-in p-4 lg:p-6 pb-24">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-3">
            <Activity className="text-emerald-400" size={28} />
            Deal Terminal
          </h1>
          <p className="text-zinc-400 mt-1">Manage network executions and escrow ledgers</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setMyDealsOnly(!myDealsOnly)}
            className={`relative flex items-center gap-2 px-6 py-3.5 rounded-xl font-bold text-sm transition-all duration-300 active:scale-95 border ${
              myDealsOnly
                ? 'text-emerald-300 bg-emerald-500/15 border-emerald-400/60 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                : 'text-zinc-500 bg-zinc-900/60 border-zinc-700/50 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            <User size={16} className={myDealsOnly ? 'text-emerald-300' : 'text-zinc-500'} />
            My Escrows
          </button>
          <Button variant="secondary" onClick={fetchAllDeals} disabled={listLoading} icon={RefreshCw}>
            Sync Ledger
          </Button>
          {onNavigateToCreate && (
            <Button variant="primary" onClick={onNavigateToCreate} icon={Plus}>
              New Contract
            </Button>
          )}
        </div>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative">

        {/* Left Panel: Deal List */}
        <Card className={`lg:col-span-4 h-[calc(100svh-260px)] lg:h-[calc(100vh-200px)] min-h-[400px] ${mobileShowDetail ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex flex-col h-full overflow-hidden">
          <div className="p-3 border-b border-zinc-800/50 bg-zinc-900/30 flex flex-col gap-3 shrink-0">
            <div className="relative group">
              <Search
                size={15}
                className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200 ${searchQuery ? 'text-emerald-400' : 'text-zinc-600 group-focus-within:text-emerald-500'}`}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ID, title, address…"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-8 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)] transition-all placeholder:text-zinc-700 font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors p-0.5 rounded"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <div className="flex items-center gap-1.5 px-1 text-[10px] font-mono">
                <span className={`font-bold ${filteredDeals.length === 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {filteredDeals.length}
                </span>
                <span className="text-zinc-600">result{filteredDeals.length !== 1 ? 's' : ''} for</span>
                <span className="text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded truncate max-w-[120px]">"{searchQuery}"</span>
              </div>
            )}
            
            <div className="relative pb-1"> {/* pb-1 to make room for horizontal scrollbar */}
            <div className="flex flex-nowrap items-center gap-1 bg-black/60 p-1 rounded-xl border border-zinc-800/60 overflow-x-auto pb-2 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-700/80 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-thumb]:rounded-full shadow-inner">
              {(['all', 'Active', 'Created', 'Completed', 'Disputed', 'Cancelled'] as const).map((tab) => {
                const count = statusCounts[tab as keyof typeof statusCounts];
                const isActive = statusFilter === tab;
                const activeStyle: Record<string, string> = {
                  all:       'text-zinc-100 bg-zinc-700/80 shadow-[0_1px_4px_rgba(0,0,0,0.6)]',
                  Active:    'text-blue-300 bg-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.2)]',
                  Created:   'text-amber-300 bg-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.2)]',
                  Completed: 'text-emerald-300 bg-emerald-500/20 shadow-[0_0_8px_rgba(52,211,153,0.2)]',
                  Disputed:  'text-red-300 bg-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.2)]',
                  Cancelled: 'text-zinc-400 bg-zinc-700/50 shadow-[0_1px_4px_rgba(0,0,0,0.4)]',
                };
                const dotStyle: Record<string, string> = {
                  Active:    'bg-blue-400',
                  Created:   'bg-amber-400',
                  Completed: 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.9)]',
                  Disputed:  'bg-red-400',
                  Cancelled: 'bg-zinc-500',
                };
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStatusFilter(tab as StatusFilter)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
                      isActive
                        ? activeStyle[tab]
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border border-transparent'
                    }`}
                  >
                    {isActive && tab !== 'all' && (
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStyle[tab]}`} />
                    )}
                    {tab === 'all' ? 'All' : STATUS_LABELS[tab]}
                    {count > 0 && (
                      <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                        isActive ? 'bg-white/10 text-inherit' : 'bg-zinc-800/60 text-zinc-500'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Removed the right-side pointer-events-none gradient so it doesn't block the scrollbar track */}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-zinc-900/50 [&::-webkit-scrollbar-thumb]:bg-zinc-700/80 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-500 [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-zinc-900 [&::-webkit-scrollbar-thumb]:rounded-full pr-2">
            {listLoading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse p-4 rounded-xl border border-zinc-800/50 bg-zinc-900/20">
                  <div className="h-4 bg-zinc-800 rounded w-1/3 mb-3"></div>
                  <div className="h-3 bg-zinc-800 rounded w-1/4 mb-2"></div>
                  <div className="h-3 bg-zinc-800 rounded w-1/2"></div>
                </div>
              ))
            ) : filteredDeals.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-500 p-6 text-center">
                <Filter size={32} className="mb-4 opacity-20" />
                <h4 className="text-zinc-400 font-medium mb-1">No contracts found</h4>
                <p className="text-sm">Try adjusting your filters or create a new deal.</p>
              </div>
            ) : (
              filteredDeals.map((deal) => {
                const status = getDealStatus(deal.data);
                const role = getRole(deal.data, walletAddress);
                const isSelected = selectedDealId === deal.id;
                
                return (
                  <div
                    key={deal.id}
                    onClick={() => { setSelectedDealId(deal.id); setMobileShowDetail(true); setSplitView(null); setLastTxHash(''); setError(''); }}
                    className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 group ${
                      isSelected 
                        ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                        : 'bg-zinc-900/30 border-zinc-800/50 hover:bg-zinc-800/50 hover:border-zinc-700'
                    }`}
                  >
                    {/* Row 1: Title */}
                    <div className="font-mono text-sm font-medium text-zinc-200 group-hover:text-emerald-400 transition-colors truncate mb-2">
                      {getDealMetadata(deal.id)?.title || `Deal #${deal.id}`}
                    </div>

                    {/* Row 2: Status badge + Amount */}
                    <div className="flex items-center justify-between gap-2">
                      <Tag color={STATUS_COLORS[status] || 'zinc'} className="whitespace-nowrap shrink-0">
                        {STATUS_LABELS[status] || status}
                      </Tag>
                      <div className="text-right shrink-0">
                        <div className="text-base font-semibold text-zinc-100 leading-tight">
                          {formatAmount(deal.data.total_amount.toString())} <span className="text-xs text-zinc-500">{getTokenSymbol(deal.data.token)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Row 3: Milestones + Role */}
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="text-xs text-zinc-500 flex items-center gap-1">
                        <Clock size={12} /> {getMilestoneProgress(deal.data)} Milestones
                      </div>
                      {role && (
                        <div className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                          {role}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </div>
        </Card>

        {/* Right Panel: Deal Details */}
        <div className={`lg:col-span-8 h-full space-y-6 ${!mobileShowDetail ? 'hidden lg:block' : 'block'}`}>
          {mobileShowDetail && (
            <button
              type="button"
              onClick={() => setMobileShowDetail(false)}
              className="lg:hidden flex items-center gap-2 text-zinc-400 hover:text-zinc-200 mb-4 transition-colors p-2 -ml-2 rounded-lg hover:bg-zinc-800/50"
            >
              <ArrowRight className="rotate-180" size={16} /> Back to Ledger
            </button>
          )}

          {!selectedDeal || selectedDealId === null ? (
            <Card className="h-[calc(100vh-200px)] min-h-[600px] bg-zinc-900/20 border-dashed border-zinc-800">
              <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-center p-8">
                <Activity size={48} className="mb-6 opacity-20" />
                <h3 className="text-xl font-semibold text-zinc-300 mb-2">Select a Contract</h3>
                <p className="max-w-md">Choose an escrow execution from the ledger to view metadata, transparent routing, and milestone signals.</p>
              </div>
            </Card>
          ) : (
            <>
              {/* Contextual Messages */}
              {lastTxHash && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                  <CheckCircle className="text-emerald-400 shrink-0 mt-0.5" size={18} />
                  <div>
                    <h4 className="text-emerald-400 font-medium text-sm">Operation Confirmed</h4>
                    <div className="flex items-center gap-3 mt-1 text-xs text-emerald-500/70">
                      <a href={getExplorerTxLink(lastTxHash)} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-300 underline underline-offset-2">View on Explorer</a>
                      <span className="cursor-pointer hover:text-emerald-300 flex items-center gap-1" onClick={() => copyToClipboard(lastTxHash, setCopiedKey, 'txhash', toast)}>
                        {copiedKey === 'txhash' ? 'Copied!' : <><Copy size={10} /> Hash</>}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
                  <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={18} />
                  <div className="flex-1">
                    <h4 className="text-red-400 font-medium text-sm">Execution Failed</h4>
                    <p className="text-red-500/70 text-xs mt-1">{error}</p>
                  </div>
                  {(error.includes('Insufficient balance') && onNavigateToFund) ? (
                    <Button variant="secondary" onClick={onNavigateToFund} className="text-xs py-1.5 px-3">Fund Wallet</Button>
                  ) : (
                    <Button variant="secondary" onClick={fetchAllDeals} className="text-xs py-1.5 px-3">Retry Sync</Button>
                  )}
                </div>
              )}

              {/* Detail Header Card */}
              <Card className="p-6 relative overflow-hidden bg-[#02040a]">
                <div className="absolute top-0 right-0 p-32 bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none" />
                
                <div className="flex flex-col md:flex-row justify-between items-start gap-6 relative z-10">
                  <div className="space-y-4 flex-1 w-full flex-wrap">
                    <div className="flex flex-wrap items-center gap-3">
                      <Tag color={STATUS_COLORS[selectedStatus] || 'zinc'}>{STATUS_LABELS[selectedStatus] || selectedStatus}</Tag>
                      {(selectedStatus === 'Active' || selectedStatus === 'Created') && (
                        <div className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                          <ShieldCheck size={14} /> Escrow Protected
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-3">
                        {selectedMeta?.title || `Dynamic Contract #${selectedDealId}`}
                        <CopyableText text={String(selectedDealId)} display={`ID: ${selectedDealId}`} label="dealid" />
                      </h2>
                      {selectedMeta?.description && <p className="text-zinc-400 mt-2 text-sm">{selectedMeta.description}</p>}
                    </div>
                    
                    {selectedMeta?.createdAt && (
                      <div className="text-xs text-zinc-500 flex items-center gap-1.5">
                        <Clock size={14} /> Created {formatEventDateTime(selectedMeta.createdAt)}
                      </div>
                    )}
                  </div>
                  
                  <div className="md:text-right bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 w-full md:w-auto">
                    <div className="text-xs text-zinc-500 mb-1">Total Locked Value</div>
                    <div className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                      {formatAmount(selectedDeal.total_amount.toString())} <span className="text-sm font-medium">{tokenSymbol}</span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-2 flex flex-col gap-1 items-end">
                      <span>Platform Routing: {selectedDeal.platform_fee_bps / 100}%</span>
                      <span>BD Share: {selectedDeal.connector_share_bps / 100}%</span>
                    </div>
                  </div>
                </div>

                {/* Participant Metadata Routing */}
                <div className="mt-8 pt-6 border-t border-zinc-800/50 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { label: 'Client (Depositor)', address: selectedDeal.client },
                    { label: 'Provider (Receiver)', address: selectedDeal.provider },
                    { label: 'Network BD (Connector)', address: selectedDeal.connector }
                  ].map((p, i) => (
                    <div key={i} className="bg-black/40 p-3 rounded-lg border border-zinc-800/50 flex flex-col gap-1.5">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 flex justify-between">
                        {p.label} {p.address === walletAddress && <span className="text-emerald-400 bg-emerald-500/10 px-1 rounded animate-pulse">YOU</span>}
                      </span>
                      <CopyableText text={p.address} label={`participant-${i}`} />
                    </div>
                  ))}
                </div>
              </Card>

              {/* Intelligent Split Execution Visualization */}
              {splitView && (() => {
                const m = selectedDeal.milestones[splitView.milestoneIdx];
                const split = m ? computeSplit(m.amount) : null;
                if (!split) return null;
                const p1 = (split.providerCut/split.total)*100;
                const p2 = (split.connectorCut/split.total)*100;
                const p3 = (split.protocolCut/split.total)*100;
                
                return (
                  <Card className="p-6 border-emerald-500/30 bg-emerald-500/5 animate-fade-in">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
                        <ArrowRight size={20} />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-emerald-400">Atomic Value Routing Executed</h3>
                        <p className="text-xs text-emerald-500/70">Single transaction split resolution for Milestone {splitView.milestoneIdx + 1}</p>
                      </div>
                    </div>
                    
                    <div className="h-4 flex rounded-full overflow-hidden bg-black border border-zinc-800 mb-4">
                      <div className="bg-emerald-500" style={{ width: `${p1}%` }}></div>
                      <div className="bg-blue-500" style={{ width: `${p2}%` }}></div>
                      <div className="bg-purple-500" style={{ width: `${p3}%` }}></div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="flex flex-col gap-1 p-3 bg-black/40 rounded-lg border border-emerald-500/20">
                        <div className="text-xs text-zinc-400 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div>Provider</div>
                        <div className="font-mono text-emerald-400">{formatAmount(split.providerCut.toString())} {tokenSymbol} <span className="opacity-50 text-xs">({p1.toFixed(1)}%)</span></div>
                      </div>
                      <div className="flex flex-col gap-1 p-3 bg-black/40 rounded-lg border border-blue-500/20">
                        <div className="text-xs text-zinc-400 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500"></div>BD Connector</div>
                        <div className="font-mono text-blue-400">{formatAmount(split.connectorCut.toString())} {tokenSymbol} <span className="opacity-50 text-xs">({p2.toFixed(1)}%)</span></div>
                      </div>
                      <div className="flex flex-col gap-1 p-3 bg-black/40 rounded-lg border border-purple-500/20">
                        <div className="text-xs text-zinc-400 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-purple-500"></div>Protocol</div>
                        <div className="font-mono text-purple-400">{formatAmount(split.protocolCut.toString())} {tokenSymbol} <span className="opacity-50 text-xs">({p3.toFixed(1)}%)</span></div>
                      </div>
                    </div>
                  </Card>
                );
              })()}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Milestone Execution Stack */}
                <div className="lg:col-span-8 space-y-4">
                  <h3 className="text-lg font-semibold text-zinc-100 mb-4 px-1 flex items-center gap-2">
                    <Activity size={18} className="text-zinc-500" /> Execution Milestones
                  </h3>
                  
                  <div className="space-y-4 pl-2 lg:pl-0 border-l border-zinc-800 lg:border-l-0 ml-4 lg:ml-0 relative">
                    <div className="absolute top-0 bottom-0 left-[15px] lg:left-[21px] w-px bg-zinc-800/50 hidden lg:block z-0"></div>
                    
                    {selectedDeal.milestones.map((m: any, i: number) => {
                      const status = getMilestoneStatus(m);
                      const isClient = selectedDeal.client === walletAddress;
                      const isParty = selectedDeal.client === walletAddress || selectedDeal.provider === walletAddress;
                      
                      return (
                        <div key={i} className={`relative flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-center bg-[#02040a] border ${status === 'Active' || status === 'Funded' ? 'border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : 'border-zinc-800/50'} p-4 lg:p-5 rounded-2xl z-10 animate-fade-in`} style={{ animationDelay: `${i*100}ms` }}>
                          
                          <div className={`hidden lg:flex shrink-0 w-10 h-10 rounded-full border-2 items-center justify-center font-bold text-sm bg-black ${status === 'Released' ? 'border-emerald-500 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : status === 'Funded' ? 'border-blue-500 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'border-zinc-700 text-zinc-500'}`}>
                            {status === 'Released' ? <CheckCircle size={16} /> : (i + 1)}
                          </div>
                          
                          <div className="flex-1 space-y-2">
                            <div className="flex flex-wrap justify-between items-start gap-2">
                              <div>
                                <h4 className="font-semibold text-zinc-200">{selectedMeta?.milestoneNames?.[i] || `Milestone ${i + 1}`}</h4>
                                <div className="text-xs text-zinc-500 mt-0.5">Disbursement Parameter</div>
                              </div>
                              <div className="text-right">
                                <div className="font-mono font-bold text-zinc-200">{formatAmount(m.amount.toString())} {tokenSymbol}</div>
                                <div className="mt-1 flex justify-end"><Tag color={MILESTONE_COLORS[status] || 'zinc'}>{MILESTONE_LABELS[status] || status}</Tag></div>
                              </div>
                            </div>
                            
                            <div className="pt-3 flex flex-wrap gap-2 justify-end w-full">
                              {status === 'Pending' && isClient && (
                                <Button onClick={() => handleDeposit(i)} disabled={actionLoading === `deposit-${i}`} className="text-xs py-1.5 px-4">
                                  {actionLoading === `deposit-${i}` ? 'Signing...' : 'Fund Escrow Node'}
                                </Button>
                              )}
                              {status === 'Funded' && isClient && (
                                <>
                                  <Button variant="secondary" onClick={() => setConfirmAction({ type: 'dispute', milestoneIdx: i })} disabled={!!actionLoading} className="text-xs py-1.5 px-3 text-red-400 hover:bg-red-500/10 border-red-500/20">
                                    Flags Dispute
                                  </Button>
                                  <Button variant="primary" onClick={() => setConfirmAction({ type: 'release', milestoneIdx: i })} disabled={!!actionLoading} className="text-xs py-1.5 px-4 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)]">
                                    Approve & Release
                                  </Button>
                                </>
                              )}
                              {status === 'Funded' && !isClient && isParty && (
                                <Button variant="secondary" onClick={() => setConfirmAction({ type: 'dispute', milestoneIdx: i })} disabled={!!actionLoading} className="text-xs py-1.5 px-3 text-red-400 border-red-500/20">
                                  Flag Dispute
                                </Button>
                              )}
                              {status === 'Disputed' && (
                                <div className="w-full space-y-2">
                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px]">
                                    <span className="shrink-0">⚖</span>
                                    <span>Under review — The Signal team handles resolution</span>
                                  </div>
                                  {isClient && (
                                    <Button variant="secondary" onClick={() => setConfirmAction({ type: 'release', milestoneIdx: i })} disabled={!!actionLoading} className="text-xs py-1.5 px-3 w-full">
                                      {actionLoading === `release-${i}` ? 'Signing...' : 'Accept & Release to Provider'}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Right Sidebar: Signal Data */}
                <div className="lg:col-span-4 space-y-6">
                  <Card className="p-5">
                    <h4 className="text-xs uppercase font-bold tracking-wider text-zinc-500 mb-4 border-b border-zinc-800 pb-2">Vault Analytics</h4>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between items-center text-zinc-400">
                        <span>Unlocked</span>
                        <span className="font-mono text-emerald-400 border-b border-emerald-500/30">{formatAmount(selectedDeal.milestones.filter((m: any) => getMilestoneStatus(m) === 'Released').reduce((sum: number, m: any) => sum + Number(m.amount), 0).toString())} {tokenSymbol}</span>
                      </div>
                      <div className="flex justify-between items-center text-zinc-400">
                        <span>Secured</span>
                        <span className="font-mono text-blue-400 border-b border-blue-500/30 animate-pulse">{formatAmount(selectedDeal.milestones.filter((m: any) => getMilestoneStatus(m) === 'Funded').reduce((sum: number, m: any) => sum + Number(m.amount), 0).toString())} {tokenSymbol}</span>
                      </div>
                      <div className="flex justify-between items-center text-zinc-400">
                        <span>Pending</span>
                        <span className="font-mono text-zinc-300">{formatAmount(selectedDeal.milestones.filter((m: any) => getMilestoneStatus(m) === 'Pending').reduce((sum: number, m: any) => sum + Number(m.amount), 0).toString())} {tokenSymbol}</span>
                      </div>
                    </div>
                  </Card>

                  {activityLog.length > 0 && (
                    <Card className="p-5">
                      <h4 className="text-xs uppercase font-bold tracking-wider text-zinc-500 mb-4 border-b border-zinc-800 pb-2">Event Ledger</h4>
                      <div className="space-y-4">
                        {activityLog.map((event, i) => (
                          <div key={i} className="flex gap-3 text-sm items-start relative before:absolute before:inset-y-0 before:left-[5px] before:w-px before:bg-zinc-800/50">
                            <div className={`w-3 h-3 rounded-full mt-1 relative z-10 border-2 border-[#02040a] ${event.action === 'funded' ? 'bg-blue-500' : event.action === 'released' || event.action === 'resolved' ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                            <div className="flex-1 space-y-1">
                              <div className="text-zinc-200">
                                {getEventLabel(event.action)} <span className="text-zinc-500">· {selectedMeta?.milestoneNames?.[event.milestoneIdx] || `MS${event.milestoneIdx + 1}`}</span>
                              </div>
                              <div className="text-xs text-zinc-600">{formatEventDateTime(event.timestamp)}</div>
                              {event.txHash && (
                                <a href={getExplorerTxLink(event.txHash)} target="_blank" rel="noopener noreferrer" className="text-[10px] inline-flex items-center gap-1 text-emerald-500 hover:text-emerald-400 transition-colors bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                  Trace <ArrowRight size={8} className="-rotate-45" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>

              </div>
            </>
          )}
        </div>
      </div>

      {/* Confirmation Modal overlay rendering */}
      {confirmAction && selectedDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in" onClick={() => setConfirmAction(null)}>
          <Card className="w-full max-w-md p-6 border-zinc-700 bg-[#02040a] shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()}>
            
            {confirmAction.type === 'release' && (() => {
              const m = selectedDeal.milestones[confirmAction.milestoneIdx];
              const split = m ? computeSplit(m.amount) : null;
              return (
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <div className="mx-auto w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
                       <ShieldCheck className="text-emerald-400" size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-zinc-100">Authorize Execution</h3>
                    <p className="text-sm text-zinc-400">This action pushes funds over the network. It cannot be reversed. Verify the transparent value split.</p>
                  </div>

                  {split && (
                    <div className="bg-black/50 border border-zinc-800 rounded-xl p-4 space-y-3 font-mono text-sm">
                      <div className="flex justify-between items-center text-emerald-400">
                        <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>Provider</span>
                        <span>{formatAmount(split.providerCut.toString())}</span>
                      </div>
                      <div className="flex justify-between items-center text-blue-400">
                        <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>Connector</span>
                        <span>{formatAmount(split.connectorCut.toString())}</span>
                      </div>
                      <div className="flex justify-between items-center text-purple-400">
                        <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div>Protocol</span>
                        <span>{formatAmount(split.protocolCut.toString())}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button variant="secondary" className="flex-1" onClick={() => setConfirmAction(null)}>Cancel</Button>
                    <Button variant="primary" className="flex-1" onClick={() => handleRelease(confirmAction.milestoneIdx)}>Sign Transaction</Button>
                  </div>
                </div>
              );
            })()}

            {confirmAction.type === 'dispute' && (
              <div className="space-y-6 text-center">
                <div className="mx-auto w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                    <AlertCircle className="text-red-400" size={24} />
                </div>
                <h3 className="text-xl font-bold text-zinc-100">Initiate Arbitration</h3>
                <p className="text-sm text-zinc-400">Disputing will freeze the funds. The protocol oracle will step in to arbitrate. Await network resolution.</p>
                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmAction(null)}>Cancel</Button>
                  <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)] border-transparent" onClick={() => handleDispute(confirmAction.milestoneIdx)}>Confirm Dispute</Button>
                </div>
              </div>
            )}

          </Card>
        </div>
      )}
    </div>
  );
}
