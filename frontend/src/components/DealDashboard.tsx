import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { truncateAddress, formatAmount, getExplorerTxLink, getTokenSymbol } from '../lib/stellar';
import { useToast } from '../App';
import type { DealData } from '../hooks/useDealEscrow';
import { getDealMetadata, recordMilestoneEvent, getAllDealEvents, formatEventDateTime, getEventLabel } from '../lib/dealMetadata';

/* ============================================
   Constants
   ============================================ */

const STATUS_LABELS: Record<string, string> = {
  Created: 'Awaiting Funding',
  Active: 'In Progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Disputed: 'Disputed',
};

const STATUS_COLORS: Record<string, string> = {
  Created: '#f59e0b',
  Active: '#3b82f6',
  Completed: '#10b981',
  Cancelled: '#ef4444',
  Disputed: '#ef4444',
};

const MILESTONE_LABELS: Record<string, string> = {
  Pending: 'Pending',
  Funded: 'Funded',
  Released: 'Released',
  Disputed: 'Disputed',
  Refunded: 'Refunded',
};

/* ============================================
   Types
   ============================================ */

interface DealWithId {
  id: number;
  data: DealData;
}

type StatusFilter = 'all' | 'Active' | 'Created' | 'Completed' | 'Disputed' | 'Cancelled';

interface Props {
  getDeal: (dealId: number) => Promise<DealData | null>;
  getDealCount: () => Promise<number>;
  onDeposit: (dealId: number, milestoneIdx: number) => Promise<{ txHash: string }>;
  onRelease: (dealId: number, milestoneIdx: number) => Promise<{ txHash: string }>;
  onDispute: (dealId: number, milestoneIdx: number) => Promise<{ txHash: string }>;
  onResolveDispute: (dealId: number, milestoneIdx: number, refundBps: number) => Promise<{ txHash: string }>;
  walletAddress: string;
  xlmBalance: string;
  initialDealId?: number | null;
  onNavigateToCreate?: () => void;
  onNavigateToFund?: () => void;
}

/* ============================================
   Helpers
   ============================================ */

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

type ToastType = 'success' | 'error' | 'info';
// Copy helper
async function copyToClipboard(text: string, setCopied: (key: string) => void, key: string, toastFn?: (msg: string, type?: ToastType) => void) {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
    toastFn?.('Copied to clipboard', 'success');
  } catch {
    // fallback: do nothing
  }
}

/* ============================================
   Inline SVG Icons
   ============================================ */

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const PersonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

/* ============================================
   Sub-components
   ============================================ */

function DealCard({ deal, isSelected, role, onClick }: {
  deal: DealWithId;
  isSelected: boolean;
  role: string | null;
  onClick: () => void;
}) {
  const tokenSymbol = getTokenSymbol(deal.data.token);
  const progress = getMilestoneProgress(deal.data);
  const isMine = role !== null;
  const status = getDealStatus(deal.data);
  const meta = getDealMetadata(deal.id);

  return (
    <button
      className={`deal-card${isSelected ? ' deal-card-selected' : ''}${isMine ? ' deal-card-mine' : ''}`}
      onClick={onClick}
      type="button"
    >
      <div className="deal-card-header">
        <span className="deal-card-id">{meta?.title || `Deal #${deal.id}`}</span>
        <span
          className="status-badge small"
          style={{ backgroundColor: STATUS_COLORS[status] || '#6b7280' }}
        >
          {STATUS_LABELS[status] || status}
        </span>
      </div>
      <div className="deal-card-body">
        <span className="deal-card-amount">
          {formatAmount(deal.data.total_amount.toString())} {tokenSymbol}
        </span>
        <span className="deal-card-progress">{progress} released</span>
      </div>
      {role && <span className="deal-card-role">{role}</span>}
    </button>
  );
}

function DealListSkeleton() {
  return (
    <div className="deal-list-skeleton">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="deal-card-skeleton skeleton" style={{ animationDelay: `${i * 0.1}s` }}>
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-line medium" />
        </div>
      ))}
    </div>
  );
}

function DealListEmpty({ hasDeals, isFiltered, onNavigateToCreate, onClearFilters }: {
  hasDeals: boolean;
  isFiltered: boolean;
  onNavigateToCreate?: () => void;
  onClearFilters: () => void;
}) {
  if (isFiltered && hasDeals) {
    return (
      <div className="deal-list-empty">
        <p>No deals match your filters.</p>
        <button className="btn-small" onClick={onClearFilters} type="button">Clear Filters</button>
      </div>
    );
  }
  return (
    <div className="deal-list-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
      <h4>No Deals Yet</h4>
      <p>Create your first escrow deal to get started.</p>
      {onNavigateToCreate && (
        <button className="btn-primary" onClick={onNavigateToCreate} type="button">Create a Deal</button>
      )}
    </div>
  );
}

function DetailEmptyState() {
  return (
    <div className="detail-empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
      <h4>Select a Deal</h4>
      <p>Choose a deal from the list to view details and manage milestones.</p>
    </div>
  );
}

/* ============================================
   Main Component
   ============================================ */

export function DealDashboard({
  getDeal, getDealCount, onDeposit, onRelease, onDispute, onResolveDispute,
  walletAddress, xlmBalance, initialDealId, onNavigateToCreate, onNavigateToFund,
}: Props) {
  const toast = useToast();

  // === Deal list state ===
  const [allDeals, setAllDeals] = useState<DealWithId[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  // === Filters ===
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [myDealsOnly, setMyDealsOnly] = useState(false);

  // === Selected deal ===
  const [selectedDealId, setSelectedDealId] = useState<number | null>(initialDealId ?? null);
  const [mobileShowDetail, setMobileShowDetail] = useState(initialDealId !== null && initialDealId !== undefined);

  // === Action state ===
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');
  const [splitView, setSplitView] = useState<{ milestoneIdx: number; txHash: string } | null>(null);

  // === Confirmation modal ===
  const [confirmAction, setConfirmAction] = useState<{
    type: 'release' | 'dispute' | 'resolve';
    milestoneIdx: number;
  } | null>(null);
  const [resolveRefundPct, setResolveRefundPct] = useState(50);

  // === Copy feedback ===
  const [copiedKey, setCopiedKey] = useState('');

  // === Data fetching ===
  const fetchAllDeals = useCallback(async () => {
    setListLoading(true);
    setListError('');
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
        .filter((r): r is PromiseFulfilledResult<DealWithId | null> =>
          r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value!);

      setAllDeals(deals);
    } catch (err: any) {
      setListError(err.message || 'Failed to fetch deals');
    } finally {
      setListLoading(false);
    }
  }, [getDeal, getDealCount]);

  // Initial load
  useEffect(() => {
    fetchAllDeals();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 30s (ref-based)
  const fetchRef = useRef(fetchAllDeals);
  fetchRef.current = fetchAllDeals;
  useEffect(() => {
    const interval = setInterval(() => fetchRef.current(), 30000);
    return () => clearInterval(interval);
  }, []);

  // When initialDealId changes (from CreateDeal), select it and refresh
  useEffect(() => {
    if (initialDealId !== null && initialDealId !== undefined) {
      setSelectedDealId(initialDealId);
      setMobileShowDetail(true);
      fetchAllDeals();
    }
  }, [initialDealId]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Derived values ===
  const filteredDeals = useMemo(() => {
    let result = allDeals;
    if (statusFilter !== 'all') {
      result = result.filter((d) => getDealStatus(d.data) === statusFilter);
    }
    if (myDealsOnly) {
      result = result.filter((d) => isParticipant(d.data, walletAddress));
    }
    return result;
  }, [allDeals, statusFilter, myDealsOnly, walletAddress]);

  const statusCounts = useMemo(() => {
    const base = myDealsOnly
      ? allDeals.filter((d) => isParticipant(d.data, walletAddress))
      : allDeals;
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

  // Activity log for selected deal
  const activityLog = useMemo(() => {
    if (selectedDealId === null || !selectedDeal) return [];
    return getAllDealEvents(selectedDealId, selectedDeal.milestones.length);
  }, [selectedDealId, selectedDeal, allDeals]); // re-derive after actions refresh allDeals

  // === Split computation ===
  const computeSplit = (milestoneAmount: bigint) => {
    if (!selectedDeal) return null;
    const amount = Number(milestoneAmount);
    const platformFee = Math.floor(amount * selectedDeal.platform_fee_bps / 10000);
    const connectorCut = Math.floor(platformFee * selectedDeal.connector_share_bps / 10000);
    const protocolCut = platformFee - connectorCut;
    const providerCut = amount - platformFee;
    return { providerCut, connectorCut, protocolCut, total: amount };
  };

  // === Action handlers ===
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
      recordMilestoneEvent(selectedDealId, milestoneIdx, {
        action: 'funded',
        timestamp: new Date().toISOString(),
        txHash: res.txHash,
      });
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
      // Record release event with split details
      const m = selectedDeal?.milestones[milestoneIdx];
      const split = m ? computeSplit(m.amount) : null;
      recordMilestoneEvent(selectedDealId, milestoneIdx, {
        action: 'released',
        timestamp: new Date().toISOString(),
        txHash: res.txHash,
        ...(split && {
          split: {
            providerAmount: split.providerCut.toString(),
            connectorAmount: split.connectorCut.toString(),
            protocolAmount: split.protocolCut.toString(),
          },
        }),
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
      recordMilestoneEvent(selectedDealId, milestoneIdx, {
        action: 'disputed',
        timestamp: new Date().toISOString(),
        txHash: res.txHash,
      });
      toast('Dispute filed on-chain', 'info');
      await fetchAllDeals();
    } catch (err: any) {
      setError(err.message || 'Dispute failed');
      toast('Dispute failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolve = async (milestoneIdx: number, refundPct: number) => {
    if (selectedDealId === null) return;
    setActionLoading(`resolve-${milestoneIdx}`);
    setError('');
    setConfirmAction(null);
    try {
      const refundBps = refundPct * 100;
      const res = await onResolveDispute(selectedDealId, milestoneIdx, refundBps);
      setLastTxHash(res.txHash);
      recordMilestoneEvent(selectedDealId, milestoneIdx, {
        action: 'resolved',
        timestamp: new Date().toISOString(),
        txHash: res.txHash,
      });
      toast('Dispute resolved successfully', 'success');
      await fetchAllDeals();
    } catch (err: any) {
      setError(err.message || 'Resolve failed');
      toast('Resolution failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // === Modal scroll lock + ESC ===
  useEffect(() => {
    if (confirmAction) {
      document.body.style.overflow = 'hidden';
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setConfirmAction(null);
      };
      window.addEventListener('keydown', handleEsc);
      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', handleEsc);
      };
    }
  }, [confirmAction]);

  // Copyable address component
  const CopyableAddress = ({ address, label }: { address: string; label: string }) => {
    const key = `addr-${label}`;
    return (
      <span
        className="copyable"
        onClick={() => copyToClipboard(address, setCopiedKey, key, toast)}
        title={`Click to copy: ${address}`}
      >
        {truncateAddress(address)}
        {copiedKey === key ? (
          <span className="copied-feedback">Copied!</span>
        ) : (
          <span className="copy-icon"><CopyIcon /></span>
        )}
      </span>
    );
  };

  // === Filter tabs config ===
  const FILTER_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'Active', label: 'Active' },
    { key: 'Created', label: 'Awaiting' },
    { key: 'Completed', label: 'Completed' },
    { key: 'Disputed', label: 'Disputed' },
    { key: 'Cancelled', label: 'Cancelled' },
  ];

  return (
    <div className="deal-dashboard">
      {/* Toolbar */}
      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-left">
          <h3>Deal Dashboard</h3>
          {!listLoading && <span className="deal-count-badge">{allDeals.length} deal{allDeals.length !== 1 ? 's' : ''}</span>}
        </div>
        <div className="dashboard-toolbar-right">
          <button
            className={`my-deals-toggle${myDealsOnly ? ' active' : ''}`}
            onClick={() => setMyDealsOnly(!myDealsOnly)}
            type="button"
          >
            <PersonIcon /> My Deals
          </button>
          <button className="refresh-btn" onClick={fetchAllDeals} disabled={listLoading} type="button" title="Refresh">
            <RefreshIcon />
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="status-filters">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`status-filter-btn${statusFilter === tab.key ? ' active' : ''}`}
            onClick={() => setStatusFilter(tab.key)}
            type="button"
          >
            {tab.label}
            {statusCounts[tab.key] > 0 && <span className="filter-count">{statusCounts[tab.key]}</span>}
          </button>
        ))}
      </div>

      {listError && (
        <div className="error-message">
          {listError}
          <button type="button" className="btn-retry" onClick={fetchAllDeals}>Retry</button>
        </div>
      )}

      {/* Main layout: list + detail */}
      <div className="dashboard-layout">
        {/* LEFT: Deal List */}
        <div className={`deal-list-panel${mobileShowDetail ? ' mobile-hidden' : ''}`}>
          {listLoading && <DealListSkeleton />}

          {!listLoading && filteredDeals.length === 0 && (
            <DealListEmpty
              hasDeals={allDeals.length > 0}
              isFiltered={statusFilter !== 'all' || myDealsOnly}
              onNavigateToCreate={onNavigateToCreate}
              onClearFilters={() => { setStatusFilter('all'); setMyDealsOnly(false); }}
            />
          )}

          {!listLoading && filteredDeals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              isSelected={selectedDealId === deal.id}
              role={getRole(deal.data, walletAddress)}
              onClick={() => {
                setSelectedDealId(deal.id);
                setMobileShowDetail(true);
                setSplitView(null);
                setLastTxHash('');
                setError('');
              }}
            />
          ))}
        </div>

        {/* RIGHT: Deal Detail */}
        <div className={`deal-detail-panel${!mobileShowDetail ? ' mobile-hidden' : ''}`}>
          {/* Mobile back button */}
          <button
            className="mobile-back-btn"
            onClick={() => setMobileShowDetail(false)}
            type="button"
          >
            <ArrowLeftIcon /> Back to list
          </button>

          {selectedDealId === null || !selectedDeal ? (
            <DetailEmptyState />
          ) : (
            <>
              {/* Success banner */}
              {lastTxHash && (
                <div className="success-banner">
                  Transaction confirmed!{' '}
                  <a href={getExplorerTxLink(lastTxHash)} target="_blank" rel="noopener noreferrer">
                    View on Explorer
                  </a>
                  <span
                    className="copyable inline-copy"
                    onClick={() => copyToClipboard(lastTxHash, setCopiedKey, 'txhash', toast)}
                    title="Copy transaction hash"
                  >
                    {copiedKey === 'txhash' ? 'Copied!' : <CopyIcon />}
                  </span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="error-message">
                  {error}
                  {error.includes('Insufficient balance') && onNavigateToFund ? (
                    <button type="button" className="btn-retry" onClick={onNavigateToFund}>Fund Wallet</button>
                  ) : (
                    <button type="button" className="btn-retry" onClick={fetchAllDeals}>Retry</button>
                  )}
                </div>
              )}

              {/* 3-Way Split Visualization */}
              {splitView && (() => {
                const m = selectedDeal.milestones[splitView.milestoneIdx];
                const split = m ? computeSplit(m.amount) : null;
                if (!split) return null;
                const pctProvider = ((split.providerCut / split.total) * 100).toFixed(1);
                const pctConnector = ((split.connectorCut / split.total) * 100).toFixed(1);
                const pctProtocol = ((split.protocolCut / split.total) * 100).toFixed(1);
                return (
                  <div className="split-visualization">
                    <h4>Atomic 3-Way Split Executed</h4>
                    <p className="split-subtitle">Milestone {splitView.milestoneIdx + 1} released in a single atomic transaction</p>
                    <div className="split-bar">
                      <div className="split-segment provider" style={{ flex: split.providerCut }}>{pctProvider}%</div>
                      <div className="split-segment connector" style={{ flex: split.connectorCut }}>{pctConnector}%</div>
                      <div className="split-segment protocol" style={{ flex: split.protocolCut }}>{pctProtocol}%</div>
                    </div>
                    <div className="split-legend">
                      <div className="split-legend-item">
                        <span className="legend-dot provider"></span>
                        <span>Provider: {formatAmount(split.providerCut.toString())} {tokenSymbol}</span>
                      </div>
                      <div className="split-legend-item">
                        <span className="legend-dot connector"></span>
                        <span>Connector: {formatAmount(split.connectorCut.toString())} {tokenSymbol}</span>
                      </div>
                      <div className="split-legend-item">
                        <span className="legend-dot protocol"></span>
                        <span>Protocol: {formatAmount(split.protocolCut.toString())} {tokenSymbol}</span>
                      </div>
                    </div>
                    {splitView.txHash && (
                      <a href={getExplorerTxLink(splitView.txHash)} target="_blank" rel="noopener noreferrer" className="explorer-link">
                        Verify on Stellar Explorer &rarr;
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Deal header */}
              <div className="deal-header">
                <div className="deal-status">
                  <span
                    className="status-badge"
                    style={{ backgroundColor: STATUS_COLORS[selectedStatus] || '#6b7280' }}
                  >
                    {STATUS_LABELS[selectedStatus] || selectedStatus}
                  </span>
                  <span className="deal-id-label">
                    {selectedMeta?.title || `Deal #${selectedDealId}`}
                    <span
                      className="copyable inline-copy"
                      onClick={() => copyToClipboard(String(selectedDealId), setCopiedKey, 'dealid', toast)}
                      title="Copy Deal ID"
                    >
                      {copiedKey === 'dealid' ? <span className="copied-feedback">Copied!</span> : <CopyIcon />}
                    </span>
                  </span>
                  {(selectedStatus === 'Active' || selectedStatus === 'Created') && (
                    <span className="escrow-badge">
                      <ShieldIcon /> Escrow Protected
                    </span>
                  )}
                </div>
                <div className="deal-amount">
                  {formatAmount(selectedDeal.total_amount.toString())} {tokenSymbol}
                </div>
                {selectedMeta?.description && (
                  <p className="deal-description">{selectedMeta.description}</p>
                )}
                {selectedMeta?.createdAt && (
                  <p className="deal-created-at">Created {formatEventDateTime(selectedMeta.createdAt)}</p>
                )}
              </div>

              {/* Completion banner */}
              {selectedStatus === 'Completed' && (
                <div className="completion-banner">
                  <span className="completion-icon">&#10003;</span>
                  Deal completed — all milestones released. Provider reputation incremented on-chain.
                </div>
              )}

              {/* Participants */}
              <div className="participants">
                <div className="participant">
                  <span className="label">Client</span>
                  <CopyableAddress address={selectedDeal.client} label="client" />
                  {selectedDeal.client === walletAddress && <span className="you-badge">You</span>}
                </div>
                <div className="participant">
                  <span className="label">Provider</span>
                  <CopyableAddress address={selectedDeal.provider} label="provider" />
                  {selectedDeal.provider === walletAddress && <span className="you-badge">You</span>}
                </div>
                <div className="participant">
                  <span className="label">Connector</span>
                  <CopyableAddress address={selectedDeal.connector} label="connector" />
                  {selectedDeal.connector === walletAddress && <span className="you-badge">You</span>}
                </div>
              </div>

              <div className="deal-meta">
                <span>Platform Fee: {selectedDeal.platform_fee_bps / 100}%</span>
                <span>Connector Share: {selectedDeal.connector_share_bps / 100}%</span>
              </div>

              {/* Milestones */}
              <h4>Milestones</h4>
              <div className="milestone-timeline">
                {selectedDeal.milestones.map((m: any, i: number) => {
                  const status = getMilestoneStatus(m);
                  const isClient = selectedDeal.client === walletAddress;
                  const isParty = selectedDeal.client === walletAddress || selectedDeal.provider === walletAddress;
                  const isLast = i === selectedDeal.milestones.length - 1;

                  return (
                    <div key={i} className="timeline-item stagger-item">
                      <div className="timeline-track">
                        <div className={`timeline-node timeline-node-${status.toLowerCase()}`}>
                          {i + 1}
                        </div>
                        {!isLast && (
                          <div className={`timeline-line ${status === 'Released' ? 'timeline-line-done' : ''}`} />
                        )}
                      </div>

                      <div className="timeline-content">
                        <div className="milestone-info">
                          <span className="milestone-name">
                            {selectedMeta?.milestoneNames?.[i] || `Milestone ${i + 1}`}
                          </span>
                          <span className={`status-badge small status-${status.toLowerCase()}`}>
                            {MILESTONE_LABELS[status] || status}
                          </span>
                          <span className="milestone-amount-display">
                            {formatAmount(m.amount.toString())} {tokenSymbol}
                          </span>
                        </div>

                        <div className="milestone-actions">
                          {status === 'Pending' && isClient && (
                            <button
                              type="button"
                              onClick={() => handleDeposit(i)}
                              disabled={actionLoading === `deposit-${i}`}
                              className="btn-fund"
                            >
                              {actionLoading === `deposit-${i}` ? 'Depositing...' : 'Fund'}
                            </button>
                          )}
                          {status === 'Funded' && isClient && (
                            <>
                              <button
                                type="button"
                                onClick={() => setConfirmAction({ type: 'release', milestoneIdx: i })}
                                disabled={actionLoading === `release-${i}`}
                                className="btn-release"
                              >
                                {actionLoading === `release-${i}` ? 'Releasing...' : 'Approve & Release'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmAction({ type: 'dispute', milestoneIdx: i })}
                                disabled={!!actionLoading}
                                className="btn-dispute"
                              >
                                Dispute
                              </button>
                            </>
                          )}
                          {status === 'Funded' && !isClient && isParty && (
                            <button
                              type="button"
                              onClick={() => setConfirmAction({ type: 'dispute', milestoneIdx: i })}
                              disabled={!!actionLoading}
                              className="btn-dispute"
                            >
                              Dispute
                            </button>
                          )}
                          {status === 'Disputed' && (
                            <button
                              type="button"
                              onClick={() => {
                                setResolveRefundPct(50);
                                setConfirmAction({ type: 'resolve', milestoneIdx: i });
                              }}
                              disabled={!!actionLoading}
                              className="btn-resolve"
                            >
                              {actionLoading === `resolve-${i}` ? 'Resolving...' : 'Resolve'}
                            </button>
                          )}
                          {status === 'Released' && (
                            <span className="released-check">&#10003; Paid</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Financial Summary */}
              <div className="financial-summary">
                <h4>Financial Summary</h4>
                <div className="financial-grid">
                  <div className="financial-item">
                    <span className="financial-label">Total Deal Value</span>
                    <span className="financial-value">{formatAmount(selectedDeal.total_amount.toString())} {tokenSymbol}</span>
                  </div>
                  <div className="financial-item">
                    <span className="financial-label">Platform Fee</span>
                    <span className="financial-value">{selectedDeal.platform_fee_bps / 100}%</span>
                  </div>
                  <div className="financial-item">
                    <span className="financial-label">Milestones Released</span>
                    <span className="financial-value">{getMilestoneProgress(selectedDeal)}</span>
                  </div>
                  <div className="financial-item">
                    <span className="financial-label">Amount Released</span>
                    <span className="financial-value">
                      {formatAmount(
                        selectedDeal.milestones
                          .filter((m: any) => getMilestoneStatus(m) === 'Released')
                          .reduce((sum: number, m: any) => sum + Number(m.amount), 0)
                          .toString()
                      )} {tokenSymbol}
                    </span>
                  </div>
                  <div className="financial-item">
                    <span className="financial-label">In Escrow</span>
                    <span className="financial-value highlight-escrow">
                      {formatAmount(
                        selectedDeal.milestones
                          .filter((m: any) => getMilestoneStatus(m) === 'Funded')
                          .reduce((sum: number, m: any) => sum + Number(m.amount), 0)
                          .toString()
                      )} {tokenSymbol}
                    </span>
                  </div>
                  <div className="financial-item">
                    <span className="financial-label">Remaining</span>
                    <span className="financial-value">
                      {formatAmount(
                        selectedDeal.milestones
                          .filter((m: any) => getMilestoneStatus(m) === 'Pending')
                          .reduce((sum: number, m: any) => sum + Number(m.amount), 0)
                          .toString()
                      )} {tokenSymbol}
                    </span>
                  </div>
                </div>
              </div>

              {/* Activity Log */}
              {activityLog.length > 0 && (
                <div className="activity-feed">
                  <h4>Activity Log</h4>
                  <div className="activity-list">
                    {activityLog.map((event, i) => (
                      <div key={i} className={`activity-item activity-${event.action}`}>
                        <div className="activity-dot" />
                        <div className="activity-content">
                          <div className="activity-header">
                            <span className="activity-label">{getEventLabel(event.action)}</span>
                            <span className="activity-milestone">
                              {selectedMeta?.milestoneNames?.[event.milestoneIdx] || `Milestone ${event.milestoneIdx + 1}`}
                            </span>
                          </div>
                          <div className="activity-time">{formatEventDateTime(event.timestamp)}</div>
                          {event.split && (
                            <div className="activity-split">
                              Provider: {formatAmount(event.split.providerAmount)} ·
                              Connector: {formatAmount(event.split.connectorAmount)} ·
                              Protocol: {formatAmount(event.split.protocolAmount)}
                            </div>
                          )}
                          {event.txHash && (
                            <a
                              href={getExplorerTxLink(event.txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="activity-tx-link"
                            >
                              View Transaction
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmAction && selectedDeal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirmation dialog" onClick={() => setConfirmAction(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            {confirmAction.type === 'release' && (() => {
              const m = selectedDeal.milestones[confirmAction.milestoneIdx];
              const split = m ? computeSplit(m.amount) : null;
              return (
                <>
                  <h3>Confirm Milestone Release</h3>
                  <p className="modal-subtitle">
                    This action is irreversible. Funds will be split atomically:
                  </p>
                  {split && (
                    <div className="modal-split-preview">
                      <div className="modal-split-row">
                        <span className="legend-dot provider"></span>
                        <span>Provider</span>
                        <span className="modal-split-amount">{formatAmount(split.providerCut.toString())} {tokenSymbol}</span>
                      </div>
                      <div className="modal-split-row">
                        <span className="legend-dot connector"></span>
                        <span>Connector</span>
                        <span className="modal-split-amount">{formatAmount(split.connectorCut.toString())} {tokenSymbol}</span>
                      </div>
                      <div className="modal-split-row">
                        <span className="legend-dot protocol"></span>
                        <span>Protocol</span>
                        <span className="modal-split-amount">{formatAmount(split.protocolCut.toString())} {tokenSymbol}</span>
                      </div>
                    </div>
                  )}
                  <div className="modal-actions">
                    <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
                    <button type="button" onClick={() => handleRelease(confirmAction.milestoneIdx)} className="btn-release">Confirm Release</button>
                  </div>
                </>
              );
            })()}

            {confirmAction.type === 'dispute' && (
              <>
                <h3>Confirm Dispute</h3>
                <p className="modal-subtitle">
                  Disputing Milestone {confirmAction.milestoneIdx + 1} will freeze this milestone.
                  An admin must resolve the dispute to release or refund funds.
                </p>
                <div className="modal-actions">
                  <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
                  <button type="button" onClick={() => handleDispute(confirmAction.milestoneIdx)} className="btn-dispute">Confirm Dispute</button>
                </div>
              </>
            )}

            {confirmAction.type === 'resolve' && (() => {
              const m = selectedDeal.milestones[confirmAction.milestoneIdx];
              const amount = m ? Number(m.amount) : 0;
              const clientRefund = Math.floor(amount * resolveRefundPct / 100);
              const providerPayout = amount - clientRefund;
              return (
                <>
                  <h3>Resolve Dispute</h3>
                  <p className="modal-subtitle">
                    Set refund percentage for Milestone {confirmAction.milestoneIdx + 1}:
                  </p>
                  <div className="resolve-slider">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={resolveRefundPct}
                      onChange={(e) => setResolveRefundPct(Number(e.target.value))}
                      aria-label="Refund percentage"
                    />
                    <div className="resolve-preview">
                      <span>Client refund: {formatAmount(clientRefund.toString())} {tokenSymbol} ({resolveRefundPct}%)</span>
                      <span>Provider payout: {formatAmount(providerPayout.toString())} {tokenSymbol} ({100 - resolveRefundPct}%)</span>
                    </div>
                  </div>
                  <div className="modal-actions">
                    <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
                    <button type="button" onClick={() => handleResolve(confirmAction.milestoneIdx, resolveRefundPct)} className="btn-primary">Resolve Dispute</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
