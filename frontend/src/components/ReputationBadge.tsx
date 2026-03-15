import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Award, Activity, Hexagon, Trophy, ExternalLink, User, AlertCircle, Crown, Briefcase, Loader2, Network } from 'lucide-react';
import { formatAmount, getExplorerContractLink, getExplorerAccountLink, DEAL_ESCROW_CONTRACT } from '../lib/stellar';
import type { DealData } from '../hooks/useDealEscrow';
import { Card, Button, Tag } from './ui/Components';

function normalizeEnum(val: any): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val[0];
  return Object.keys(val)[0];
}

function getDealStatus(deal: DealData): string { return normalizeEnum(deal.status); }
function getMilestoneStatus(m: any): string { return normalizeEnum(m.status); }

function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);
  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}

interface DealActivity {
  total: number;
  asClient: number;
  asProvider: number;
  asConnector: number;
  completed: number;
  active: number;
  totalVolume: bigint;
  milestonesReleased: number;
  milestonesTotal: number;
}

interface LeaderEntry {
  address: string;
  completedDeals: number;
  totalDeals: number;
  volume: bigint;
  milestonesReleased: number;
  milestonesTotal: number;
}

interface Props {
  getReputation: (address: string) => Promise<number>;
  getDealCount: () => Promise<number>;
  getDeal: (dealId: number) => Promise<DealData | null>;
  walletAddress: string;
}

export function ReputationBadge({ getReputation, getDealCount, getDeal, walletAddress }: Props) {
  const [address, setAddress] = useState(walletAddress || '');
  const [reputation, setReputation] = useState<number | null>(null);
  const [activity, setActivity] = useState<DealActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const displayRep = useCountUp(reputation ?? 0);
  const autoFetched = useRef(false);

  // Leaderboard — fetched once on mount from all on-chain deals
  const [leaderboard, setLeaderboard] = useState<{ clients: LeaderEntry[]; providers: LeaderEntry[]; connectors: LeaderEntry[] } | null>(null);
  const [leaderLoading, setLeaderLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const count = await getDealCount();
        if (!count) { setLeaderLoading(false); return; }
        const max = Math.min(count, 50);
        const start = Math.max(0, count - max);
        const results = await Promise.allSettled(
          Array.from({ length: max }, (_, i) => getDeal(start + i))
        );
        const deals = results
          .filter((r): r is PromiseFulfilledResult<DealData | null> => r.status === 'fulfilled' && r.value !== null)
          .map((r) => r.value!);

        const clientMap = new Map<string, LeaderEntry>();
        const providerMap = new Map<string, LeaderEntry>();
        const connectorMap = new Map<string, LeaderEntry>();

        const blank = (addr: string): LeaderEntry => ({
          address: addr, completedDeals: 0, totalDeals: 0,
          volume: BigInt(0), milestonesReleased: 0, milestonesTotal: 0,
        });

        for (const deal of deals) {
          const isCompleted = getDealStatus(deal) === 'Completed';
          let msReleased = 0;
          for (const m of deal.milestones) {
            if (getMilestoneStatus(m) === 'Released') msReleased++;
          }

          if (deal.client) {
            const e = clientMap.get(deal.client) ?? blank(deal.client);
            e.totalDeals++;
            if (isCompleted) e.completedDeals++;
            e.volume += deal.total_amount;
            e.milestonesReleased += msReleased;
            e.milestonesTotal += deal.milestones.length;
            clientMap.set(deal.client, e);
          }
          if (deal.provider) {
            const e = providerMap.get(deal.provider) ?? blank(deal.provider);
            e.totalDeals++;
            if (isCompleted) e.completedDeals++;
            e.volume += deal.total_amount;
            e.milestonesReleased += msReleased;
            e.milestonesTotal += deal.milestones.length;
            providerMap.set(deal.provider, e);
          }
          if (deal.connector) {
            const e = connectorMap.get(deal.connector) ?? blank(deal.connector);
            e.totalDeals++;
            if (isCompleted) e.completedDeals++;
            e.volume += deal.total_amount;
            e.milestonesReleased += msReleased;
            e.milestonesTotal += deal.milestones.length;
            connectorMap.set(deal.connector, e);
          }
        }

        const sortClients = [...clientMap.values()]
          .sort((a, b) => b.completedDeals - a.completedDeals || Number(b.volume - a.volume > 0n ? 1 : -1))
          .slice(0, 5);

        const sortProviders = [...providerMap.values()]
          .sort((a, b) => {
            const rA = a.milestonesTotal ? a.milestonesReleased / a.milestonesTotal : 0;
            const rB = b.milestonesTotal ? b.milestonesReleased / b.milestonesTotal : 0;
            return Math.abs(rB - rA) > 0.01
              ? rB - rA
              : Number(b.volume - a.volume > 0n ? 1 : -1);
          })
          .slice(0, 5);

        const sortConnectors = [...connectorMap.values()]
          .sort((a, b) => b.totalDeals - a.totalDeals || Number(b.volume - a.volume > 0n ? 1 : -1))
          .slice(0, 5);

        if (!cancelled) setLeaderboard({ clients: sortClients, providers: sortProviders, connectors: sortConnectors });
      } catch { /* chain unreachable */ }
      if (!cancelled) setLeaderLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLookup = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError('');
    setReputation(null);
    setActivity(null);

    try {
      const [rep, count] = await Promise.all([
        getReputation(address),
        getDealCount(),
      ]);
      setReputation(rep);

      if (count > 0) {
        const dealIds = Array.from({ length: count }, (_, i) => i);
        const results = await Promise.allSettled(dealIds.map((id) => getDeal(id)));
        const deals = results
          .filter((r): r is PromiseFulfilledResult<DealData | null> => r.status === 'fulfilled' && r.value !== null)
          .map((r) => r.value!);

        let asClient = 0, asProvider = 0, asConnector = 0, completed = 0, active = 0, milestonesReleased = 0, milestonesTotal = 0;
        let totalVolume = BigInt(0);

        for (const deal of deals) {
          const isInvolved = deal.client === address || deal.provider === address || deal.connector === address;
          if (!isInvolved) continue;

          if (deal.client === address) asClient++;
          if (deal.provider === address) asProvider++;
          if (deal.connector === address) asConnector++;

          const status = getDealStatus(deal);
          if (status === 'Completed') completed++;
          if (status === 'Active') active++;

          totalVolume += deal.total_amount;
          for (const m of deal.milestones) {
            milestonesTotal++;
            if (getMilestoneStatus(m) === 'Released') milestonesReleased++;
          }
        }

        const total = asClient + asProvider + asConnector;
        if (total > 0) {
           setActivity({ total, asClient, asProvider, asConnector, completed, active, totalVolume, milestonesReleased, milestonesTotal });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch reputation');
    } finally {
      setLoading(false);
    }
  }, [address, getReputation, getDealCount, getDeal]);

  useEffect(() => {
    if (walletAddress && !autoFetched.current) {
      autoFetched.current = true;
      handleLookup();
    }
  }, [walletAddress, handleLookup]);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 pb-32 animate-fade-in relative z-10">
      
      {/* Header */}
      <div className="flex flex-col items-center text-center space-y-6 mb-12">
        {/* Radar Icon */}
        <div className="relative mb-4">
          <div className="absolute inset-0 bg-emerald-500/5 blur-3xl rounded-full"></div>
          <div className="relative w-28 h-28 rounded-full border border-emerald-500/30 bg-[#02040a] flex items-center justify-center shadow-[inset_0_0_30px_rgba(16,185,129,0.1)] overflow-hidden">
            <div className="absolute top-1/2 left-1/2 w-[112px] h-[112px] -translate-x-1/2 -translate-y-1/2 origin-center animate-radar">
              <div className="w-full h-full bg-[conic-gradient(from_0deg,transparent_80%,rgba(74,222,128,0.35)_100%)] rounded-full"></div>
            </div>
            <div className="absolute inset-4 border border-emerald-500/10 rounded-full"></div>
            <div className="absolute inset-8 border border-emerald-500/15 rounded-full"></div>
            <Award size={28} className="text-emerald-400 relative z-10 drop-shadow-[0_0_12px_rgba(74,222,128,1)]" />
          </div>
        </div>

        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <span className="text-xs font-bold tracking-widest uppercase">On-Chain Oracle</span>
        </div>
        <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight">
          Trust, but <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-green-300">Verify</span>
        </h2>
        <p className="text-zinc-400 max-w-2xl mx-auto">
          Query the execution ledger to cryptographically verify any participant's deal history, volume, and settled milestones.
        </p>
      </div>

      {/* Search Input */}
      <div className="flex flex-col md:flex-row gap-4 max-w-2xl mx-auto">
        <div className="relative flex-1 group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-emerald-500 transition-colors" size={20} />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            placeholder="Enter Public Key (G...)"
            title="Search public key"
            className="w-full bg-[#050505] border border-zinc-800 rounded-2xl py-5 pl-14 pr-5 text-white font-mono text-sm focus:border-emerald-500/60 focus:shadow-[0_0_30px_rgba(16,185,129,0.08)] outline-none transition-all placeholder:text-zinc-700"
          />
        </div>
        <Button onClick={handleLookup} disabled={loading || !address} variant="primary" className="px-10 py-5 whitespace-nowrap">
          {loading ? 'Scanning...' : 'Scan Ledger'}
        </Button>
      </div>

      {walletAddress && address !== walletAddress && (
        <div className="flex justify-center -mt-4">
          <button type="button" onClick={() => setAddress(walletAddress)} className="text-sm text-zinc-500 hover:text-emerald-400 transition-colors flex items-center gap-2">
            <User size={14} /> Load my connected wallet
          </button>
        </div>
      )}

      {error && (
        <Card className="max-w-3xl mx-auto p-4 bg-red-500/10 border-red-500/20 text-red-400 flex items-center gap-3">
          <AlertCircle size={20} /> <span className="font-medium">{error}</span>
        </Card>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <Card className="max-w-4xl mx-auto p-10 bg-[#02040a] flex flex-col items-center justify-center min-h-[400px]">
          <Hexagon className="w-16 h-16 text-emerald-500/20 animate-spin-slow mb-6" />
          <div className="h-6 w-48 bg-zinc-800 animate-pulse rounded-full mb-4"></div>
          <div className="h-4 w-64 bg-zinc-800 animate-pulse rounded-full"></div>
        </Card>
      )}

      {/* Results */}
      {!loading && (reputation !== null || activity !== null) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto animate-fade-in mt-12">
          
          {/* Main Reputation Score Card */}
          <Card className="lg:col-span-1 bg-gradient-to-b from-[#02040a] to-[#09090b]" glowOnHover>
            <div className="p-8 flex flex-col items-center justify-center text-center h-full min-h-[380px]">
            <div className="relative mb-8 group">
              <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="w-32 h-32 rounded-full border border-emerald-500/30 bg-[#02040a] relative z-10 flex flex-col items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                <Trophy className="text-emerald-400 mb-2" size={24} />
                <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-emerald-200">
                  {displayRep}
                </span>
              </div>
            </div>
            
            <h3 className="text-xl font-bold text-white mb-2">Verified Provider</h3>
            <p className="text-sm text-zinc-500 mb-6 border-b border-zinc-800/50 pb-6">
              Reputation points earned exclusively through completed, dispute-free milestones.
            </p>

            <div className="flex flex-wrap gap-2 justify-center w-full">
              {reputation !== null && reputation >= 1 && <Tag color="emerald">Verified</Tag>}
              {reputation !== null && reputation >= 5 && <Tag color="blue">Trusted</Tag>}
              {reputation !== null && reputation >= 10 && <Tag color="amber">Elite</Tag>}
              {reputation === 0 && <Tag color="zinc">New Entity</Tag>}
            </div>
            </div>
          </Card>

          {/* Activity Breakdown */}
          {activity && (
            <Card className="lg:col-span-2 p-8 bg-[#02040a]">
              <div className="flex justify-between items-start mb-8 flex-col sm:flex-row gap-4">
                <div>
                  <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <Activity className="text-emerald-400" size={20} />
                    On-Chain Activity
                  </h3>
                  <div className="font-mono text-xs text-zinc-500 bg-zinc-900 px-3 py-1 rounded w-fit mt-3 border border-zinc-800 word-break-all break-all sm:break-normal">
                    {address}
                  </div>
                </div>
                <div className="sm:text-right">
                  <div className="text-sm text-zinc-500 uppercase tracking-widest font-bold mb-1">Total Volume</div>
                  <div className="text-2xl font-mono font-black text-emerald-400">
                    {formatAmount(activity.totalVolume.toString())} XLM
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-white mb-1">{activity.total}</div>
                  <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Total Deals</div>
                </div>
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-blue-400 mb-1">{activity.completed}</div>
                  <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Successfully Settled</div>
                </div>
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-emerald-400 mb-1">{activity.active}</div>
                  <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Currently Active</div>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-zinc-400 font-medium">Network Participation</span>
                    <span className="text-emerald-400 font-mono">
                      {activity.asClient} Client / {activity.asProvider} Provider / {activity.asConnector} BD
                    </span>
                  </div>
                  <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden flex">
                    <div style={{ width: `${(activity.asClient / activity.total) * 100}%` }} className="bg-blue-500 h-full"></div>
                    <div style={{ width: `${(activity.asProvider / activity.total) * 100}%` }} className="bg-emerald-500 h-full"></div>
                    <div style={{ width: `${(activity.asConnector / activity.total) * 100}%` }} className="bg-purple-500 h-full"></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-zinc-400 font-medium">Milestone Release Rate</span>
                    <span className="text-emerald-400 font-mono">
                      {activity.milestonesReleased} / {activity.milestonesTotal}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden">
                    <div 
                      style={{ width: activity.milestonesTotal > 0 ? `${(activity.milestonesReleased / activity.milestonesTotal) * 100}%` : '0%' }} 
                      className="bg-emerald-400 h-full shadow-[0_0_10px_rgba(52,211,153,0.8)]"
                    ></div>
                  </div>
                </div>
              </div>

              {DEAL_ESCROW_CONTRACT && (
                <div className="mt-8 pt-6 border-t border-zinc-800/50 flex justify-end">
                  <a href={getExplorerContractLink(DEAL_ESCROW_CONTRACT)} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" icon={ExternalLink} className="text-sm">
                      View Contract Source
                    </Button>
                  </a>
                </div>
              )}
            </Card>
          )}

        </div>
      )}

      {/* ── Leaderboard ── */}
      <div className="max-w-6xl mx-auto mt-16 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Crown size={18} className="text-amber-400" />
          <h3 className="text-lg font-black uppercase tracking-widest text-white">On-Chain Leaderboard</h3>
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">live · testnet</span>
        </div>

        {leaderLoading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-zinc-600">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Scanning ledger…</span>
          </div>
        ) : !leaderboard || (leaderboard.clients.length === 0 && leaderboard.providers.length === 0) ? (
          <p className="text-sm text-zinc-600 text-center py-8">No on-chain data found.</p>
        ) : (
          <div className="space-y-6">
            {/* Top Clients + Top Providers — 2 columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Clients */}
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-5 pb-4 border-b border-zinc-800/60">
                  <User size={14} className="text-blue-400" />
                  <h4 className="text-xs font-black uppercase tracking-widest text-zinc-300">Top Clients</h4>
                  <span className="ml-auto text-[9px] text-zinc-600 uppercase tracking-widest">by completed deals</span>
                </div>
                <div className="space-y-3">
                  {leaderboard.clients.map((entry, i) => (
                    <div key={entry.address} className="flex items-center gap-3">
                      <span className={`w-6 text-center text-xs font-black shrink-0 ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-700' : 'text-zinc-600'}`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAddress(entry.address)}
                          title="Scan in Oracle"
                          className="font-mono text-xs text-emerald-400 hover:text-emerald-300 transition-colors truncate text-left"
                        >
                          {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                        </button>
                        <a
                          href={getExplorerAccountLink(entry.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on Stellar Expert"
                          className="text-zinc-600 hover:text-blue-400 transition-colors shrink-0"
                        >
                          <ExternalLink size={10} />
                        </a>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs font-bold text-zinc-200">{entry.completedDeals} <span className="text-zinc-600 font-normal">done</span></div>
                        <div className="text-[10px] font-mono text-blue-400">{(Number(entry.volume) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 0 })} XLM</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Top Providers */}
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-5 pb-4 border-b border-zinc-800/60">
                  <Briefcase size={14} className="text-emerald-400" />
                  <h4 className="text-xs font-black uppercase tracking-widest text-zinc-300">Top Providers</h4>
                  <span className="ml-auto text-[9px] text-zinc-600 uppercase tracking-widest">by release rate</span>
                </div>
                <div className="space-y-3">
                  {leaderboard.providers.map((entry, i) => {
                    const rate = entry.milestonesTotal
                      ? Math.round((entry.milestonesReleased / entry.milestonesTotal) * 100)
                      : 0;
                    return (
                      <div key={entry.address} className="flex items-center gap-3">
                        <span className={`w-6 text-center text-xs font-black shrink-0 ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-700' : 'text-zinc-600'}`}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAddress(entry.address)}
                            title="Scan in Oracle"
                            className="font-mono text-xs text-emerald-400 hover:text-emerald-300 transition-colors truncate text-left"
                          >
                            {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                          </button>
                          <a
                            href={getExplorerAccountLink(entry.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on Stellar Expert"
                            className="text-zinc-600 hover:text-emerald-400 transition-colors shrink-0"
                          >
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs font-bold text-zinc-200">{rate}% <span className="text-zinc-600 font-normal">released</span></div>
                          <div className="text-[10px] font-mono text-emerald-400">{(Number(entry.volume) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 0 })} XLM</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            {/* Top BD (Connectors) — full width */}
            {leaderboard.connectors.length > 0 && (
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-5 pb-4 border-b border-zinc-800/60">
                  <Network size={14} className="text-purple-400" />
                  <h4 className="text-xs font-black uppercase tracking-widest text-zinc-300">Top BD Connectors</h4>
                  <span className="ml-auto text-[9px] text-zinc-600 uppercase tracking-widest">by deals facilitated</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  {leaderboard.connectors.map((entry, i) => (
                    <div key={entry.address} className="flex items-center gap-3 bg-zinc-900/40 border border-zinc-800/50 rounded-xl px-3 py-2.5">
                      <span className={`w-5 text-center text-xs font-black shrink-0 ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-700' : 'text-zinc-600'}`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAddress(entry.address)}
                            title="Scan in Oracle"
                            className="font-mono text-xs text-purple-400 hover:text-purple-300 transition-colors truncate text-left"
                          >
                            {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                          </button>
                          <a
                            href={getExplorerAccountLink(entry.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on Stellar Expert"
                            className="text-zinc-600 hover:text-purple-400 transition-colors shrink-0"
                          >
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="font-bold text-zinc-200">{entry.totalDeals} <span className="text-zinc-600 font-normal">deals</span></span>
                          <span className="text-zinc-700">·</span>
                          <span className="font-mono text-purple-400">{(Number(entry.volume) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 0 })} XLM</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
