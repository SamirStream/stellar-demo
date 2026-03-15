import { useState } from 'react';
import { toContractAmount, XLM_SAC_ADDRESS, USDC_TOKEN_ADDRESS, TOKENS, DEMO_ACCOUNTS, isValidStellarAddress, getExplorerTxLink } from '../lib/stellar';
import { saveDealMetadata } from '../lib/dealMetadata';
import { useToast } from '../App';
import { Card, Button, Tag } from './ui/Components';
import { Settings2, Plus, X, Search, Coins, AlertCircle, ArrowRight, CheckCircle2, FileText, Check, ShieldCheck, Zap } from 'lucide-react';

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
      <div className="w-full max-w-2xl mx-auto animate-fade-in py-12">
        <Card className="p-10 flex flex-col items-center text-center relative overflow-hidden bg-[#02040a]">
          <div className="absolute top-0 right-0 p-32 bg-emerald-500/10 blur-[100px] rounded-full point-events-none" />
          <div className="absolute bottom-0 left-0 p-32 bg-emerald-500/5 blur-[100px] rounded-full point-events-none" />
          
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)] mb-6 z-10">
            <CheckCircle2 size={40} className="text-emerald-400" />
          </div>
          
          <h3 className="text-3xl font-black text-white mb-2 tracking-tight z-10">Contract Deployed</h3>
          <p className="text-zinc-400 mb-8 z-10">The trustless escrow agreement is now live on the Stellar network.</p>
          
          <div className="w-full bg-[#09090b]/80 border border-zinc-800 rounded-xl p-6 text-left space-y-4 mb-8 z-10">
            <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
              <span className="text-zinc-500 text-sm font-medium">Deal ID</span>
              <span className="text-emerald-400 font-mono font-bold">#{result.dealId}</span>
            </div>
            {result.txHash && (
              <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                <span className="text-zinc-500 text-sm font-medium">Transaction</span>
                <a href={getExplorerTxLink(result.txHash)} target="_blank" rel="noopener noreferrer" className="text-emerald-400 font-mono font-medium hover:text-emerald-300 underline underline-offset-2 flex items-center gap-1">
                  {result.txHash.slice(0, 16)}... <ArrowRight size={14} />
                </a>
              </div>
            )}
            <div className="flex justify-between items-center py-2">
              <span className="text-zinc-500 text-sm font-medium">Overview</span>
              <span className="text-white font-medium">{milestones.length} milestones &middot; {totalAmount} {tokenSymbol}</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full z-10">
            <Button
              onClick={() => onDealCreated?.(result.dealId)}
              variant="primary"
              className="py-4 w-full"
              icon={Zap}
            >
              View Dashboard
            </Button>
            <Button onClick={() => setResult(null)} variant="secondary" className="py-4 w-full" icon={Plus}>
              Initialize New
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Review / summary step before contract call
  if (showReview) {
    const providerPct = 100 - platformFee;
    const connectorPct = (platformFee * connectorShare) / 100;
    const protocolPct = platformFee - connectorPct;

    return (
      <div className="w-full max-w-4xl mx-auto animate-fade-in">
         <div className="mb-8">
            <h2 className="text-3xl font-black text-white tracking-tighter uppercase mb-2">Initialize Deployment</h2>
            <p className="text-zinc-500 font-medium">Final verification of contract parameters before signing.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 bg-[#02040a]">
              <div className="flex items-center gap-3 mb-6">
                <FileText className="text-emerald-400" />
                <h4 className="text-xl font-bold text-white tracking-tight">Contract Overview</h4>
              </div>
              
              {dealTitle && (
                <div className="mb-6 pb-6 border-b border-zinc-800/50">
                  <h5 className="text-lg font-bold text-white mb-2">{dealTitle}</h5>
                  {dealDescription && <p className="text-zinc-400 text-sm leading-relaxed bg-zinc-900/50 p-4 rounded-lg border border-zinc-800/50">{dealDescription}</p>}
                </div>
              )}

              <div className="space-y-4">
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-1">Service Provider</span>
                    <span className="text-zinc-300 font-mono text-sm">{provider}</span>
                  </div>
                  <Tag color="amber">Executor</Tag>
                </div>
                
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-1">Business Developer (Connector)</span>
                    <span className="text-zinc-300 font-mono text-sm">{connector}</span>
                  </div>
                  <Tag color="zinc">Referrer</Tag>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-[#02040a]">
              <div className="flex items-center gap-3 mb-6">
                <CheckCircle2 className="text-emerald-400" />
                <h4 className="text-xl font-bold text-white tracking-tight">Milestone Schedule</h4>
              </div>
              
              <div className="space-y-3">
                {milestones.map((m, i) => (
                  <div key={i} className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <span className="text-white font-medium block">{m.name}</span>
                      <span className="text-zinc-500 text-sm">{m.percentage}% of total</span>
                    </div>
                    <div className="text-right">
                       <span className="font-mono text-emerald-400 font-bold block">
                          {((totalAmount * m.percentage) / 100).toLocaleString()} {tokenSymbol}
                       </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
             <Card className="p-6 bg-[#02040a] sticky top-6">
                <h4 className="text-xl font-bold text-white tracking-tight mb-6">Execution Summary</h4>
                
                <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest block mb-1">Total Locked Value</span>
                  <span className="text-3xl font-mono font-bold text-emerald-400">
                    {totalAmount.toLocaleString()} <span className="text-xl">{tokenSymbol}</span>
                  </span>
                </div>

                <div className="space-y-4 mb-8">
                  <h5 className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-2">Split Per Release</h5>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-zinc-400">Provider</span>
                    <span className="text-white font-medium">{providerPct}%</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-zinc-400">Connector</span>
                    <span className="text-emerald-400 font-medium">{connectorPct.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-zinc-400">Protocol</span>
                    <span className="text-white font-medium">{protocolPct.toFixed(1)}%</span>
                  </div>
                </div>

                {error && (
                  <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex gap-2 items-start">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {txStep && (
                  <div className="mb-6 space-y-3 font-mono text-sm">
                    <div className={`flex items-center gap-3 ${txStep === 'signing' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {txStep === 'signing' ? <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> : <Check size={14} />} 
                      Requesting Signature
                    </div>
                    <div className={`flex items-center gap-3 ${txStep === 'submitting' ? 'text-emerald-400' : txStep === 'confirming' ? 'text-zinc-500' : 'text-zinc-700'}`}>
                      {txStep === 'submitting' ? <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> : txStep === 'confirming' ? <Check size={14} /> : <span className="w-2 h-2 rounded-full bg-zinc-800" />}
                      Broadcasting to Network
                    </div>
                    <div className={`flex items-center gap-3 ${txStep === 'confirming' ? 'text-emerald-400 animate-pulse' : 'text-zinc-700'}`}>
                      {txStep === 'confirming' ? <span className="w-2 h-2 rounded-full bg-emerald-400" /> : <span className="w-2 h-2 rounded-full bg-zinc-800" />}
                      Awaiting Finality
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <Button
                    onClick={handleConfirm}
                    disabled={loading}
                    variant="primary"
                    className="w-full py-4 text-base"
                    icon={ShieldCheck}
                  >
                    {loading ? 'Deploying...' : 'Deploy Contract'}
                  </Button>
                  <Button
                    onClick={() => setShowReview(false)}
                    disabled={loading}
                    variant="secondary"
                    className="w-full py-2"
                  >
                    Modify Parameters
                  </Button>
                </div>
             </Card>
          </div>
        </div>
      </div>
    );
  }

  // Input Form
  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase mb-2">Contract Parameters</h2>
          <p className="text-zinc-500 font-medium">Configure new trustless agreement attributes.</p>
        </div>
        
        {/* Demo Scenarios */}
        <div className="flex gap-2">
           <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest shrink-0 mt-2">Presets:</span>
            <div className="flex flex-wrap gap-2">
              {DEMO_SCENARIOS.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => loadScenario(s)}
                  className="bg-zinc-900 border border-zinc-700 hover:border-emerald-500/50 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Zap size={12} className="text-emerald-400" />
                  {s.name}
                </button>
              ))}
            </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 space-y-8">
            {/* General Info */}
            <Card className="p-8 bg-[#02040a]">
              <div className="flex items-center gap-3 mb-6">
                <Settings2 className="text-emerald-400" />
                <h3 className="text-xl font-bold text-white tracking-tight">General Info</h3>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2">Deal Title</label>
                  <input
                    type="text"
                    value={dealTitle}
                    onChange={(e) => setDealTitle(e.target.value)}
                    placeholder="e.g. Security Audit for DeFi Protocol"
                    className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/50 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
                
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2">Description</label>
                  <textarea
                    value={dealDescription}
                    onChange={(e) => setDealDescription(e.target.value)}
                    placeholder="Brief description of the scope of work..."
                    rows={3}
                    className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/50 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 outline-none transition-colors resize-none"
                  />
                </div>
              </div>
            </Card>

            {/* Participants */}
            <Card className="p-8 bg-[#02040a]">
              <div className="flex items-center gap-3 mb-6">
                 <Search className="text-emerald-400" />
                <h3 className="text-xl font-bold text-white tracking-tight">Participants</h3>
              </div>
              
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block">Provider Address</label>
                    <span className="text-[10px] text-zinc-600 font-mono uppercase">Executor</span>
                  </div>
                  <input
                    type="text"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="G..."
                    required
                    className={`w-full bg-[#09090b] border ${provider && !isValidStellarAddress(provider) ? 'border-red-500/50 focus:border-red-500/50' : 'border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/50'} rounded-xl px-4 py-3 text-white font-mono text-sm placeholder:text-zinc-700 outline-none transition-colors`}
                  />
                  {provider && !isValidStellarAddress(provider) && (
                    <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1"><AlertCircle size={12}/> Invalid Stellar address format</p>
                  )}
                </div>

                <div>
                   <div className="flex justify-between items-end mb-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block">Connector Address</label>
                    <span className="text-[10px] text-zinc-600 font-mono uppercase">BD Referrer</span>
                  </div>
                  <input
                    type="text"
                    value={connector}
                    onChange={(e) => setConnector(e.target.value)}
                    placeholder="G..."
                    required
                    className={`w-full bg-[#09090b] border ${connector && !isValidStellarAddress(connector) ? 'border-red-500/50 focus:border-red-500/50' : 'border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/50'} rounded-xl px-4 py-3 text-white font-mono text-sm placeholder:text-zinc-700 outline-none transition-colors`}
                  />
                  {connector && !isValidStellarAddress(connector) && (
                    <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1"><AlertCircle size={12}/> Invalid Stellar address format</p>
                  )}
                </div>
              </div>
            </Card>

            {/* Milestones */}
            <Card className="p-8 bg-[#02040a]">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Coins className="text-emerald-400" />
                  <h3 className="text-xl font-bold text-white tracking-tight">Deliverables Schedule</h3>
                </div>
                <div className="flex items-center gap-3">
                   <div className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${totalMilestonePercent === 100 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                      Total: {totalMilestonePercent}%
                   </div>
                   <Button onClick={addMilestone} variant="secondary" className="py-1.5 px-3 text-xs" icon={Plus}>Add</Button>
                </div>
              </div>

              <div className="space-y-4">
                {milestones.map((m, i) => (
                  <div key={i} className="flex gap-4 items-start pb-4 border-b border-zinc-800/50 last:border-0 last:pb-0">
                    <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-500 shrink-0 mt-2">
                      {i + 1}
                    </div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4">
                      <div className="md:col-span-7">
                        <label className="text-[10px] font-bold text-zinc-600 uppercase mb-1 block">Description</label>
                        <input
                          type="text"
                          value={m.name}
                          onChange={(e) => updateMilestoneName(i, e.target.value)}
                          placeholder="Milestone name"
                          className="w-full bg-[#09090b] border border-zinc-800 focus:border-emerald-500/50 rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors"
                        />
                      </div>
                      <div className="md:col-span-5 flex gap-3">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-zinc-600 uppercase mb-1 block">Value</label>
                          <div className="relative">
                            <input
                              type="number"
                              value={m.percentage}
                              onChange={(e) => updateMilestonePercentage(i, Number(e.target.value))}
                              min={1}
                              max={100}
                              className="w-full bg-[#09090b] border border-zinc-800 focus:border-emerald-500/50 rounded-lg pl-3 pr-8 py-2 text-sm text-white font-mono outline-none transition-colors"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm font-bold">%</span>
                          </div>
                        </div>
                        {milestones.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeMilestone(i)}
                            className="mt-5 w-9 h-9 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors border border-red-500/20 shrink-0"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

          </div>

          <div className="space-y-8">
            <Card className="p-6 bg-[#02040a] sticky top-6">
              <h3 className="text-xl font-bold text-white tracking-tight mb-6">Financial Setup</h3>

              <div className="space-y-6">
                 <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2">Total Amount</label>
                  <div className="flex gap-2">
                     <select
                        value={paymentToken}
                        onChange={(e) => setPaymentToken(e.target.value as 'XLM' | 'USDC')}
                        className="bg-[#09090b] border border-zinc-800 focus:border-emerald-500/50 rounded-xl px-3 py-3 text-white font-bold outline-none cursor-pointer"
                      >
                        <option value="XLM">XLM</option>
                        <option value="USDC">USDC</option>
                      </select>
                      <input
                        type="number"
                        value={totalAmount}
                        onChange={(e) => setTotalAmount(Number(e.target.value))}
                        min={1}
                        required
                        className="w-full bg-[#09090b] border border-zinc-800 focus:border-emerald-500/50 rounded-xl px-4 py-3 text-xl font-mono font-bold text-emerald-400 outline-none transition-colors"
                      />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800/50">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Platform Fee</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={platformFee}
                        onChange={(e) => setPlatformFee(Number(e.target.value))}
                        min={10}
                        max={100}
                        required
                        className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-700 rounded-lg pl-3 pr-7 py-2 text-sm text-white font-mono outline-none"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-bold">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">BD Share</label>
                     <div className="relative">
                      <input
                        type="number"
                        value={connectorShare}
                        onChange={(e) => setConnectorShare(Number(e.target.value))}
                        min={30}
                        max={50}
                        required
                        className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-700 rounded-lg pl-3 pr-7 py-2 text-sm text-white font-mono outline-none"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-bold">%</span>
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800/50">
                    <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-3 text-center">Split Simulation</h5>
                    <div className="space-y-2">
                       <div className="flex justify-between items-center text-sm">
                          <span className="text-zinc-400">Provider</span>
                          <span className="text-white font-medium">{100 - platformFee}%</span>
                       </div>
                       <div className="flex justify-between items-center text-sm">
                          <span className="text-zinc-400">BD</span>
                          <span className="text-emerald-400 font-medium">{((platformFee * connectorShare) / 100).toFixed(1)}%</span>
                       </div>
                       <div className="flex justify-between items-center text-sm">
                          <span className="text-zinc-400">Protocol</span>
                          <span className="text-white font-medium">{(platformFee - (platformFee * connectorShare) / 100).toFixed(1)}%</span>
                       </div>
                    </div>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex gap-2 items-start">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  disabled={loading || totalMilestonePercent !== 100}
                  variant="primary"
                  className="w-full py-4 text-base mt-4"
                  icon={ArrowRight}
                >
                   Review Payload
                </Button>
              </div>

            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
