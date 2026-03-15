import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Award, Activity, Hexagon, Trophy, ExternalLink, User, AlertCircle } from 'lucide-react';
import { formatAmount, getExplorerContractLink, DEAL_ESCROW_CONTRACT } from '../lib/stellar';
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
      <div className="text-center space-y-4 mb-12">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-2">
          <Award size={14} />
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
      <Card className="max-w-3xl mx-auto p-4 flex gap-4 bg-[#02040a]" glowOnHover>
        <div className="relative flex-1">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500" />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search public key (G...)"
            title="Search public key"
            className="w-full bg-[#09090b] border border-zinc-800 text-white rounded-xl pl-12 pr-4 py-4 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
          />
        </div>
        <Button onClick={handleLookup} disabled={loading || !address} variant="primary" className="px-8 whitespace-nowrap">
          {loading ? 'Scanning...' : 'Scan Ledger'}
        </Button>
      </Card>

      {walletAddress && address !== walletAddress && (
        <div className="flex justify-center -mt-4">
          <button onClick={() => setAddress(walletAddress)} className="text-sm text-zinc-500 hover:text-emerald-400 transition-colors flex items-center gap-2">
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
          <Card className="lg:col-span-1 p-8 flex flex-col items-center justify-center text-center bg-gradient-to-b from-[#02040a] to-[#09090b]" glowOnHover>
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
    </div>
  );
}
