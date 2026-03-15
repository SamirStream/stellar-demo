import { useState } from 'react';
import { fundTestnetAccount, getExplorerTxLink } from '../lib/stellar';
import { soroswapClient, TESTNET_TOKENS } from '../lib/soroswap';
import { useToast } from '../App';
import type { SwapQuote } from '../lib/soroswap';
import { Card, Button, Tag } from './ui/Components';
import { Zap, ArrowDown, ExternalLink, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';

interface Props {
  walletAddress: string;
  signTransaction: (xdr: string, opts?: any) => Promise<string>;
  onSwapComplete?: (usdcAmount: string) => void;
  onFundComplete?: () => void;
  onBalanceRefresh?: () => void;
  xlmBalance?: string;
}

export function SoroswapWidget({ walletAddress, signTransaction, onSwapComplete, onFundComplete, onBalanceRefresh, xlmBalance }: Props) {
  const toast = useToast();
  // Friendbot section
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingResult, setFundingResult] = useState<'success' | 'error' | null>(null);

  // Soroswap section
  const [xlmAmount, setXlmAmount] = useState('10');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');

  const handleFundbot = async () => {
    setFundingLoading(true);
    setFundingResult(null);
    const success = await fundTestnetAccount(walletAddress);
    setFundingResult(success ? 'success' : 'error');
    setFundingLoading(false);
    if (success) {
      toast('Wallet funded with 10,000 XLM!', 'success');
      onBalanceRefresh?.();
    } else {
      toast('Wallet already funded! You\'re ready to go.', 'info');
      onBalanceRefresh?.();
    }
  };

  const fetchQuote = async () => {
    const amount = parseFloat(xlmAmount);
    if (!amount || amount <= 0) return;

    setQuoteLoading(true);
    setError('');
    try {
      const stroops = BigInt(Math.round(amount * 1e7)).toString();
      const q = await soroswapClient.getQuote(
        TESTNET_TOKENS.XLM,
        TESTNET_TOKENS.USDC,
        stroops
      );
      setQuote(q);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch quote');
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleSwap = async () => {
    if (!quote) return;
    setSwapLoading(true);
    setError('');

    try {
      const xdr = await soroswapClient.buildTransaction(quote, walletAddress);
      const signedXdr = await signTransaction(xdr, {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: walletAddress,
      });
      const result = await soroswapClient.sendTransaction(signedXdr);
      setTxHash(result.txHash);
      toast('Swap completed!', 'success');
      if (onSwapComplete && quote.amountOut) {
        onSwapComplete(quote.amountOut);
      }
    } catch (err: any) {
      setError(err.message || 'Swap failed');
      toast('Swap failed', 'error');
    } finally {
      setSwapLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase mb-2">Liquidity Terminal</h2>
          <p className="text-zinc-500 font-medium">Provision testnet assets for smart contract execution.</p>
        </div>
        {xlmBalance && (
          <div className="bg-[#09090b] border border-zinc-800 rounded-xl px-5 py-3 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-1">Network Balance</span>
            <span className="font-mono text-emerald-400 font-bold text-xl">
              {parseFloat(xlmBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Section 1: Friendbot Funding */}
        <Card className="p-8 flex flex-col h-full bg-[#02040a]" glowOnHover>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">1</div>
            <h3 className="text-xl font-bold text-white tracking-tight">Initialize Vault</h3>
          </div>
          
          <p className="text-zinc-400 text-sm mb-8 flex-1 leading-relaxed">
            Request 10,000 XLM from the Soroban friendbot. Native XLM is required for gas fees and can be used directly as payment in escrow deals.
          </p>

          <div className="space-y-4">
            <Button
              onClick={handleFundbot}
              disabled={fundingLoading}
              variant="primary"
              className="w-full py-4"
              icon={fundingLoading ? RefreshCw : Zap}
            >
              Request 10,000 XLM
            </Button>

            {fundingResult === 'success' && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex flex-col gap-3 animate-fade-in">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle2 size={16} />
                  <span>Vault successfully provisioned.</span>
                </div>
                {onFundComplete && (
                  <Button onClick={onFundComplete} variant="secondary" className="w-full py-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20">
                    Deploy Contract →
                  </Button>
                )}
              </div>
            )}
            
            {fundingResult === 'error' && (
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-3 animate-fade-in">
                <div className="flex items-center gap-2 text-zinc-300 font-medium text-sm">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                  <span>Vault already holds sufficient XLM.</span>
                </div>
                {onFundComplete && (
                  <Button onClick={onFundComplete} variant="secondary" className="w-full py-2">
                    Deploy Contract →
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Section 2: Soroswap Integration */}
        <Card className="p-8 flex flex-col h-full bg-[#02040a]" glowOnHover>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-white font-bold">2</div>
              <h3 className="text-xl font-bold text-white tracking-tight">Acquire USDC</h3>
            </div>
            <Tag color="zinc">Soroswap DEX</Tag>
          </div>

          <p className="text-zinc-500 text-xs mb-6 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
            Swap XLM for USDC using testnet liquidity pools. If pools are empty, use XLM directly for escrow deals.
          </p>

          {txHash ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 animate-fade-in py-8">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]">
                <CheckCircle2 size={32} className="text-emerald-400" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-white mb-2 tracking-tight">Atomic Swap Executed</h4>
                <p className="text-zinc-400 text-sm font-mono mb-6">
                  {xlmAmount} XLM → {quote ? (parseFloat(quote.amountOut) / 1e7).toFixed(2) : '?'} USDC
                </p>
                <div className="flex flex-col gap-3">
                  <a
                    href={getExplorerTxLink(txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm font-bold bg-emerald-500/10 hover:bg-emerald-500/20 px-6 py-3 rounded-xl transition-colors border border-emerald-500/20"
                  >
                    View TX on Explorer <ExternalLink size={14} />
                  </a>
                  <Button
                    onClick={() => { setTxHash(''); setQuote(null); setXlmAmount('10'); }}
                    variant="secondary"
                  >
                    Initialize New Swap
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col space-y-6">
              {/* Swap Inputs */}
              <div className="space-y-2 relative">
                {/* Pay */}
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 focus-within:border-emerald-500/50 transition-colors shadow-inner">
                  <div className="flex justify-between mb-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Pay Amount</label>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="number"
                      value={xlmAmount}
                      onChange={(e) => { setXlmAmount(e.target.value); setQuote(null); }}
                      placeholder="0.0"
                      min="0"
                      step="any"
                      className="bg-transparent text-3xl font-mono text-white outline-none w-full placeholder:text-zinc-700 appearance-none"
                    />
                    <div className="flex items-center gap-2 bg-zinc-800/80 rounded-lg px-3 py-1.5 shrink-0 border border-zinc-700">
                      <div className="w-5 h-5 rounded-full bg-white text-black text-[10px] font-black flex items-center justify-center">X</div>
                      <span className="font-bold text-sm">XLM</span>
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-zinc-800 border-2 border-[#02040a] flex items-center justify-center text-zinc-400">
                  <ArrowDown size={16} />
                </div>

                {/* Receive */}
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 shadow-inner opacity-80">
                  <div className="flex justify-between mb-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Receive Estimate</label>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="text"
                      value={
                        quoteLoading
                          ? 'Computing...'
                          : quote
                            ? (parseFloat(quote.amountOut) / 1e7).toFixed(2)
                            : '0.00'
                      }
                      readOnly
                      className="bg-transparent text-3xl font-mono text-white outline-none w-full truncate"
                    />
                    <div className="flex items-center gap-2 bg-[#2775ca]/20 rounded-lg px-3 py-1.5 shrink-0 border border-[#2775ca]/30">
                      <div className="w-5 h-5 rounded-full bg-[#2775ca] text-white text-[10px] font-black flex items-center justify-center">$</div>
                      <span className="font-bold text-sm text-[#2775ca]">USDC</span>
                    </div>
                  </div>
                </div>
              </div>

              {quote && (
                <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800/50 text-xs font-mono text-zinc-400 flex flex-col gap-2">
                   <div className="flex justify-between">
                     <span>Exchange Rate</span>
                     <span className="text-white">1 XLM = {(parseFloat(quote.amountOut) / 1e7 / parseFloat(xlmAmount)).toFixed(4)} USDC</span>
                   </div>
                   <div className="flex justify-between">
                     <span>Slippage Tolerance</span>
                     <span className="text-emerald-400">1.0%</span>
                   </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="flex-1">{error}</span>
                  <button onClick={() => { setError(''); fetchQuote(); }} className="font-bold hover:text-red-300 underline">Retry</button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mt-auto pt-4">
                <Button
                  onClick={fetchQuote}
                  disabled={quoteLoading || !xlmAmount || parseFloat(xlmAmount) <= 0}
                  variant="secondary"
                  className="py-4"
                >
                  Calculate Route
                </Button>
                <Button
                  onClick={handleSwap}
                  disabled={swapLoading || !quote}
                  variant={quote ? "primary" : "secondary"}
                  className="py-4"
                >
                  Execute Swap
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
