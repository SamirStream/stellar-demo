import { useState } from 'react';
import { toContractAmount, XLM_SAC_ADDRESS, USDC_TOKEN_ADDRESS, TOKENS, DEMO_ACCOUNTS, isValidStellarAddress, getExplorerTxLink } from '../lib/stellar';
import { saveDealMetadata } from '../lib/dealMetadata';
import { useToast } from '../App';

interface MilestoneInput {
  name: string;
  percentage: number;
}

const DEMO_SCENARIOS = [
  {
    name: 'Security Audit',
    description: 'Smart contract security audit for a DeFi protocol',
    totalAmount: 500,
    milestones: [
      { name: 'Initial Code Review', percentage: 30 },
      { name: 'Vulnerability Report', percentage: 50 },
      { name: 'Final Remediation Check', percentage: 20 },
    ],
    platformFee: 10,
    connectorShare: 50,
  },
  {
    name: 'Dev Sprint',
    description: 'Full-stack development sprint for marketplace features',
    totalAmount: 1200,
    milestones: [
      { name: 'Frontend Implementation', percentage: 50 },
      { name: 'Backend + Integration', percentage: 50 },
    ],
    platformFee: 10,
    connectorShare: 50,
  },
  {
    name: 'Advisory Retainer',
    description: 'Quarterly advisory engagement for go-to-market strategy',
    totalAmount: 3000,
    milestones: [
      { name: 'Market Analysis', percentage: 25 },
      { name: 'Strategy Document', percentage: 25 },
      { name: 'Launch Support', percentage: 25 },
      { name: 'Post-Launch Review', percentage: 25 },
    ],
    platformFee: 10,
    connectorShare: 50,
  },
];

interface Props {
  onCreateDeal: (
    provider: string,
    connector: string,
    tokenAddress: string,
    platformFeeBps: number,
    connectorShareBps: number,
    milestoneAmounts: bigint[]
  ) => Promise<{ dealId: number; txHash: string }>;
  onDealCreated?: (dealId: number) => void;
}

export function CreateDeal({ onCreateDeal, onDealCreated }: Props) {
  const toast = useToast();
  const [dealTitle, setDealTitle] = useState('');
  const [dealDescription, setDealDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [connector, setConnector] = useState('');
  const [totalAmount, setTotalAmount] = useState(500);
  const [paymentToken, setPaymentToken] = useState<'XLM' | 'USDC'>('XLM');
  const [platformFee, setPlatformFee] = useState(10);
  const [connectorShare, setConnectorShare] = useState(50);
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { name: 'Initial Code Review', percentage: 30 },
    { name: 'Vulnerability Report', percentage: 50 },
    { name: 'Final Remediation Check', percentage: 20 },
  ]);
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState<'signing' | 'submitting' | 'confirming' | null>(null);
  const [result, setResult] = useState<{ dealId: number; txHash: string } | null>(null);
  const [error, setError] = useState('');
  const [showReview, setShowReview] = useState(false);

  const tokenSymbol = TOKENS[paymentToken].symbol;

  const loadScenario = (scenario: typeof DEMO_SCENARIOS[0]) => {
    setDealTitle(scenario.name);
    setDealDescription(scenario.description);
    setProvider(DEMO_ACCOUNTS.provider);
    setConnector(DEMO_ACCOUNTS.connector);
    setTotalAmount(scenario.totalAmount);
    setPaymentToken('XLM');
    setPlatformFee(scenario.platformFee);
    setConnectorShare(scenario.connectorShare);
    setMilestones(scenario.milestones.map((m) => ({ ...m })));
    setError('');
  };

  const updateMilestonePercentage = (index: number, value: number) => {
    const updated = [...milestones];
    updated[index] = { ...updated[index], percentage: value };
    setMilestones(updated);
  };

  const updateMilestoneName = (index: number, name: string) => {
    const updated = [...milestones];
    updated[index] = { ...updated[index], name };
    setMilestones(updated);
  };

  const addMilestone = () => {
    setMilestones([...milestones, { name: `Milestone ${milestones.length + 1}`, percentage: 0 }]);
  };

  const removeMilestone = (index: number) => {
    if (milestones.length <= 1) return;
    setMilestones(milestones.filter((_, i) => i !== index));
  };

  const totalMilestonePercent = milestones.reduce((a, b) => a + b.percentage, 0);

  // Step 1: Validate → show review
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isValidStellarAddress(provider)) {
      setError('Invalid provider address. Must be a 56-character Stellar address starting with G.');
      return;
    }
    if (!isValidStellarAddress(connector)) {
      setError('Invalid connector address. Must be a 56-character Stellar address starting with G.');
      return;
    }
    if (milestones.some((m) => m.percentage <= 0)) {
      setError('All milestones must be greater than 0%');
      return;
    }
    if (totalMilestonePercent !== 100) {
      setError('Milestone percentages must sum to 100%');
      return;
    }
    if (totalAmount <= 0) {
      setError('Total amount must be greater than 0');
      return;
    }

    const tokenAddress = paymentToken === 'XLM' ? XLM_SAC_ADDRESS : USDC_TOKEN_ADDRESS;
    if (!tokenAddress) {
      setError('Token address not configured. Check your .env file.');
      return;
    }

    setShowReview(true);
  };

  // Step 2: Confirm → submit to contract
  const handleConfirm = async () => {
    const tokenAddress = paymentToken === 'XLM' ? XLM_SAC_ADDRESS : USDC_TOKEN_ADDRESS;
    if (!tokenAddress) return;

    setLoading(true);
    setError('');
    setTxStep('signing');
    try {
      const milestoneAmounts = milestones.map((m) =>
        toContractAmount((totalAmount * m.percentage) / 100)
      );

      setTxStep('submitting');
      const res = await onCreateDeal(
        provider.trim(),
        connector.trim(),
        tokenAddress,
        platformFee * 100,
        connectorShare * 100,
        milestoneAmounts
      );

      // Save deal metadata to localStorage (title, milestone names, timestamps)
      saveDealMetadata(res.dealId, {
        title: dealTitle || `Deal #${res.dealId}`,
        description: dealDescription,
        milestoneNames: milestones.map((m) => m.name),
        createdAt: new Date().toISOString(),
        txHash: res.txHash,
      });

      setTxStep('confirming');
      setResult(res);
      setShowReview(false);
      toast(`Deal #${res.dealId} created on Stellar!`, 'success');
    } catch (err: any) {
      console.error('[CreateDeal] Failed:', err);
      setError(err.message || 'Failed to create deal');
      toast('Deal creation failed', 'error');
    } finally {
      setLoading(false);
      setTxStep(null);
    }
  };

  if (result) {
    return (
      <div className="card success-card">
        <div className="success-icon-animated">
          <svg viewBox="0 0 52 52">
            <circle className="check-circle" cx="26" cy="26" r="25" />
            <path className="check-mark" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
          </svg>
        </div>
        <h3>Deal Created Successfully!</h3>
        <div className="result-details">
          <p><strong>Deal ID:</strong> <span className="highlight">{result.dealId}</span></p>
          {result.txHash && (
            <p>
              <strong>Transaction:</strong>{' '}
              <a href={getExplorerTxLink(result.txHash)} target="_blank" rel="noopener noreferrer">
                {result.txHash.slice(0, 16)}...
              </a>
            </p>
          )}
          <p className="text-muted">
            {milestones.length} milestones, {totalAmount} {tokenSymbol} total
          </p>
        </div>
        <div className="success-actions">
          <button
            onClick={() => onDealCreated?.(result.dealId)}
            className="btn-primary"
          >
            View Deal Dashboard
          </button>
          <button onClick={() => setResult(null)} className="btn-secondary">
            Create Another Deal
          </button>
        </div>
      </div>
    );
  }

  // Review / summary step before contract call
  if (showReview) {
    const providerPct = 100 - platformFee;
    const connectorPct = (platformFee * connectorShare) / 100;
    const protocolPct = platformFee - connectorPct;

    return (
      <div className="card review-card">
        <h3>Review Deal Before Submission</h3>
        <p className="card-subtitle">Please verify the deal parameters before signing the transaction.</p>

        {dealTitle && (
          <div className="review-section">
            <h4>{dealTitle}</h4>
            {dealDescription && <p className="review-description">{dealDescription}</p>}
          </div>
        )}

        <div className="review-section">
          <h4>Participants</h4>
          <div className="review-row">
            <span className="review-label">Provider</span>
            <span className="review-value mono">{provider.slice(0, 8)}...{provider.slice(-6)}</span>
          </div>
          <div className="review-row">
            <span className="review-label">Connector (BD)</span>
            <span className="review-value mono">{connector.slice(0, 8)}...{connector.slice(-6)}</span>
          </div>
        </div>

        <div className="review-section">
          <h4>Payment</h4>
          <div className="review-row">
            <span className="review-label">Token</span>
            <span className="review-value">{tokenSymbol}</span>
          </div>
          <div className="review-row">
            <span className="review-label">Total Amount</span>
            <span className="review-value highlight">{totalAmount.toLocaleString()} {tokenSymbol}</span>
          </div>
        </div>

        <div className="review-section">
          <h4>Milestones</h4>
          {milestones.map((m, i) => (
            <div key={i} className="review-row">
              <span className="review-label">{m.name} ({m.percentage}%)</span>
              <span className="review-value mono">{((totalAmount * m.percentage) / 100).toLocaleString()} {tokenSymbol}</span>
            </div>
          ))}
        </div>

        <div className="review-section">
          <h4>Split Preview (per release)</h4>
          <div className="review-row">
            <span className="review-label">Provider receives</span>
            <span className="review-value">{providerPct}%</span>
          </div>
          <div className="review-row">
            <span className="review-label">Connector receives</span>
            <span className="review-value">{connectorPct.toFixed(1)}%</span>
          </div>
          <div className="review-row">
            <span className="review-label">Protocol receives</span>
            <span className="review-value">{protocolPct.toFixed(1)}%</span>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        {txStep && (
          <div className="tx-progress">
            <div className={`tx-step ${txStep === 'signing' ? 'active' : ''} ${txStep !== 'signing' ? 'done' : ''}`}>
              <span className="tx-spinner" /> Signing
            </div>
            <div className="tx-step-divider" />
            <div className={`tx-step ${txStep === 'submitting' ? 'active' : ''} ${txStep === 'confirming' ? 'done' : ''}`}>
              <span className="tx-spinner" /> Submitting
            </div>
            <div className="tx-step-divider" />
            <div className={`tx-step ${txStep === 'confirming' ? 'active' : ''}`}>
              <span className="tx-spinner" /> Confirming
            </div>
          </div>
        )}

        <div className="review-actions">
          <button
            type="button"
            onClick={() => setShowReview(false)}
            disabled={loading}
            className="btn-secondary"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? 'Creating Deal on Stellar...' : 'Create Deal on Stellar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>Create New Deal</h3>
      </div>

      {/* Demo Scenarios */}
      <div className="scenarios">
        <label className="scenarios-label">Quick Start</label>
        <div className="scenario-buttons">
          {DEMO_SCENARIOS.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => loadScenario(s)}
              className="btn-scenario"
            >
              <span className="scenario-name">{s.name}</span>
              <span className="scenario-meta">{s.totalAmount} XLM &middot; {s.milestones.length} milestones</span>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Deal Title</label>
          <input
            type="text"
            value={dealTitle}
            onChange={(e) => setDealTitle(e.target.value)}
            placeholder="e.g. Security Audit for DeFi Protocol"
            aria-label="Deal title"
          />
          <span className="field-hint">A human-readable name for this deal</span>
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={dealDescription}
            onChange={(e) => setDealDescription(e.target.value)}
            placeholder="Brief description of the scope of work..."
            rows={2}
            aria-label="Deal description"
          />
        </div>

        <div className="form-group">
          <label>Provider Address (service provider)</label>
          <input
            type="text"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="G..."
            required
            aria-label="Provider Stellar address"
            className={provider && !isValidStellarAddress(provider) ? 'input-error' : ''}
          />
          <span className="field-hint">Stellar public key (G...) of the service provider who delivers the work</span>
          {provider && !isValidStellarAddress(provider) && (
            <span className="field-error">Invalid Stellar address</span>
          )}
        </div>

        <div className="form-group">
          <label>Connector Address (BD referrer)</label>
          <input
            type="text"
            value={connector}
            onChange={(e) => setConnector(e.target.value)}
            placeholder="G..."
            required
            aria-label="Connector Stellar address"
            className={connector && !isValidStellarAddress(connector) ? 'input-error' : ''}
          />
          <span className="field-hint">BD connector who referred this deal — earns a share of the platform fee</span>
          {connector && !isValidStellarAddress(connector) && (
            <span className="field-error">Invalid Stellar address</span>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Payment Token</label>
            <select
              value={paymentToken}
              onChange={(e) => setPaymentToken(e.target.value as 'XLM' | 'USDC')}
              aria-label="Payment Token"
            >
              <option value="XLM">XLM (Native)</option>
              <option value="USDC">USDC</option>
            </select>
          </div>

          <div className="form-group">
            <label>Total Amount ({tokenSymbol})</label>
            <input
              type="number"
              value={totalAmount}
              onChange={(e) => setTotalAmount(Number(e.target.value))}
              min={1}
              required
              aria-label={`Total amount in ${tokenSymbol}`}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Platform Fee (%)</label>
            <input
              type="number"
              value={platformFee}
              onChange={(e) => setPlatformFee(Number(e.target.value))}
              min={10}
              max={100}
              required
              aria-label="Platform fee percentage"
            />
            <span className="field-hint">Total fee deducted from each milestone release (min 10%)</span>
          </div>

          <div className="form-group">
            <label>Connector Share (%)</label>
            <input
              type="number"
              value={connectorShare}
              onChange={(e) => setConnectorShare(Number(e.target.value))}
              min={30}
              max={50}
              required
              aria-label="Connector share percentage"
            />
            <span className="field-hint">Connector's portion of the platform fee (30% to 50%)</span>
          </div>
        </div>

        <div className="milestones-section">
          <div className="section-header">
            <h4>
              Milestones ({totalMilestonePercent}%{' '}
              {totalMilestonePercent !== 100 && (
                <span className="error-text">- must be 100%</span>
              )}
              {totalMilestonePercent === 100 && (
                <span className="success-text">&#10003;</span>
              )}
              )
            </h4>
            <button type="button" onClick={addMilestone} className="btn-small">
              + Add
            </button>
          </div>

          {milestones.map((m, i) => (
            <div key={i} className="milestone-row stagger-item">
              <input
                type="text"
                value={m.name}
                onChange={(e) => updateMilestoneName(i, e.target.value)}
                placeholder={`Milestone ${i + 1}`}
                className="milestone-name-input"
                aria-label={`Milestone ${i + 1} name`}
              />
              <input
                type="number"
                value={m.percentage}
                onChange={(e) => updateMilestonePercentage(i, Number(e.target.value))}
                min={1}
                max={100}
                className="milestone-pct-input"
                aria-label={`Milestone ${i + 1} percentage`}
              />
              <span className="milestone-amount">
                {((totalAmount * m.percentage) / 100).toLocaleString()} {tokenSymbol}
              </span>
              {milestones.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMilestone(i)}
                  className="btn-remove"
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="split-preview">
          <h4>Split Preview (per milestone release)</h4>
          <div className="split-row">
            <span>Provider receives</span>
            <span className="split-value">{100 - platformFee}%</span>
          </div>
          <div className="split-row">
            <span>Connector (BD) receives</span>
            <span className="split-value">{((platformFee * connectorShare) / 100).toFixed(1)}%</span>
          </div>
          <div className="split-row">
            <span>Protocol (The Signal) receives</span>
            <span className="split-value">
              {(platformFee - (platformFee * connectorShare) / 100).toFixed(1)}%
            </span>
          </div>
          <div className="split-row split-total">
            <span>Total</span>
            <span className="split-value">100%</span>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <button
          type="submit"
          disabled={loading || totalMilestonePercent !== 100}
          className="btn-primary"
        >
          {loading ? 'Creating Deal on Stellar...' : `Create Deal (${totalAmount} ${tokenSymbol})`}
        </button>
      </form>
    </div>
  );
}
