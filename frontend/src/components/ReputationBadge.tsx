import { useState, useCallback, useEffect, useRef } from 'react';
import { truncateAddress, formatAmount, getExplorerContractLink, getTokenSymbol, DEAL_ESCROW_CONTRACT } from '../lib/stellar';
import type { DealData } from '../hooks/useDealEscrow';

// Soroban enums deserialize as arrays ["Created"] or objects { Active: [] } — normalize to string
function normalizeEnum(val: any): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val[0];
  return Object.keys(val)[0];
}

function getDealStatus(deal: DealData): string {
  return normalizeEnum(deal.status);
}

function getMilestoneStatus(m: any): string {
  return normalizeEnum(m.status);
}

// Count-up animation hook
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
      // easeOutCubic
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
      // Fetch reputation + deal activity in parallel
      const [rep, count] = await Promise.all([
        getReputation(address),
        getDealCount(),
      ]);
      setReputation(rep);

      // Fetch all deals and compute participation
      if (count > 0) {
        const dealIds = Array.from({ length: count }, (_, i) => i);
        const results = await Promise.allSettled(
          dealIds.map((id) => getDeal(id))
        );

        const deals = results
          .filter((r): r is PromiseFulfilledResult<DealData | null> =>
            r.status === 'fulfilled' && r.value !== null
          )
          .map((r) => r.value!);

        let asClient = 0;
        let asProvider = 0;
        let asConnector = 0;
        let completed = 0;
        let active = 0;
        let totalVolume = BigInt(0);
        let milestonesReleased = 0;
        let milestonesTotal = 0;

        for (const deal of deals) {
          const isInvolved =
            deal.client === address ||
            deal.provider === address ||
            deal.connector === address;
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
          setActivity({
            total,
            asClient,
            asProvider,
            asConnector,
            completed,
            active,
            totalVolume,
            milestonesReleased,
            milestonesTotal,
          });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch reputation');
    } finally {
      setLoading(false);
    }
  }, [address, getReputation, getDealCount, getDeal]);

  // Auto-fetch on mount with connected wallet
  useEffect(() => {
    if (walletAddress && !autoFetched.current) {
      autoFetched.current = true;
      handleLookup();
    }
  }, [walletAddress, handleLookup]);

  return (
    <div className="card">
      <h3>On-Chain Profile</h3>
      <p className="card-subtitle">
        Reputation and deal activity verified on-chain via Soroban
      </p>

      <div className="reputation-lookup">
        <div className="form-group">
          <label>Lookup Address</label>
          <div className="reputation-search">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="G..."
            />
            <button
              onClick={handleLookup}
              disabled={loading || !address}
              className="btn-primary reputation-search-btn"
            >
              {loading ? 'Loading...' : 'Lookup'}
            </button>
          </div>
        </div>

        {walletAddress && address !== walletAddress && (
          <button
            onClick={() => setAddress(walletAddress)}
            className="btn-small"
          >
            Use My Address
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading && (
        <div className="reputation-result">
          <div className="reputation-card">
            <div className="skeleton-row skeleton-centered">
              <div className="skeleton skeleton-circle skeleton-circle-lg" />
            </div>
            <div className="skeleton skeleton-line medium skeleton-centered-line" />
            <div className="skeleton skeleton-line short skeleton-centered-line" />
          </div>
        </div>
      )}

      {!loading && (reputation !== null || activity !== null) && (
        <div className="reputation-result">
          {/* Deal Activity Card */}
          {activity && (
            <div className="reputation-card activity-card">
              <div className="reputation-score">
                <span className="score-number">{activity.total}</span>
                <span className="score-label">Deal{activity.total !== 1 ? 's' : ''} On-Chain</span>
              </div>

              <div className="reputation-address">
                {truncateAddress(address)}
              </div>

              {/* Role breakdown */}
              <div className="activity-stats">
                {activity.asClient > 0 && (
                  <div className="activity-stat">
                    <span className="activity-stat-value">{activity.asClient}</span>
                    <span className="activity-stat-label">as Client</span>
                  </div>
                )}
                {activity.asProvider > 0 && (
                  <div className="activity-stat">
                    <span className="activity-stat-value">{activity.asProvider}</span>
                    <span className="activity-stat-label">as Provider</span>
                  </div>
                )}
                {activity.asConnector > 0 && (
                  <div className="activity-stat">
                    <span className="activity-stat-value">{activity.asConnector}</span>
                    <span className="activity-stat-label">as Connector</span>
                  </div>
                )}
              </div>

              {/* Progress stats */}
              <div className="activity-progress">
                <div className="activity-progress-row">
                  <span>Milestones Released</span>
                  <span className="activity-progress-value">
                    {activity.milestonesReleased}/{activity.milestonesTotal}
                  </span>
                </div>
                <div className="activity-progress-bar">
                  <div
                    className="activity-progress-fill"
                    style={{ width: activity.milestonesTotal > 0 ? `${(activity.milestonesReleased / activity.milestonesTotal) * 100}%` : '0%' }}
                  />
                </div>
                <div className="activity-progress-row">
                  <span>Completed Deals</span>
                  <span className="activity-progress-value">
                    {activity.completed}/{activity.total}
                  </span>
                </div>
                <div className="activity-progress-bar">
                  <div
                    className="activity-progress-fill completed"
                    style={{ width: activity.total > 0 ? `${(activity.completed / activity.total) * 100}%` : '0%' }}
                  />
                </div>
                {activity.active > 0 && (
                  <div className="activity-progress-row">
                    <span>Active Now</span>
                    <span className="activity-progress-value highlight-active">{activity.active}</span>
                  </div>
                )}
              </div>

              {/* Total volume */}
              <div className="activity-volume">
                Total Volume: <strong>{formatAmount(activity.totalVolume.toString())} XLM</strong>
              </div>
            </div>
          )}

          {/* Provider Reputation Card */}
          {reputation !== null && (
            <div className="reputation-card">
              <h4 className="reputation-section-title">Provider Reputation Score</h4>
              <div className="reputation-score">
                <span className="score-number">{displayRep}</span>
                <span className="score-label">Completed as Provider</span>
              </div>

              <div className="reputation-badges">
                {reputation >= 1 && (
                  <span className="badge badge-verified">Verified Provider</span>
                )}
                {reputation >= 5 && (
                  <span className="badge badge-trusted">Trusted Provider</span>
                )}
                {reputation >= 10 && (
                  <span className="badge badge-elite">Elite Provider</span>
                )}
                {reputation === 0 && (
                  <span className="badge badge-new">New Provider</span>
                )}
              </div>

              <div className="reputation-info">
                <p>
                  The provider reputation counter increments on-chain each time
                  all milestones of a deal are released. It cannot be faked or altered.
                </p>
                {DEAL_ESCROW_CONTRACT && (
                  <a
                    href={getExplorerContractLink(DEAL_ESCROW_CONTRACT)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="explorer-link"
                  >
                    View Contract on Explorer
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
