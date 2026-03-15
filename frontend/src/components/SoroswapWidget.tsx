import { useState } from 'react';
import { fundTestnetAccount, getExplorerTxLink } from '../lib/stellar';
import { soroswapClient, TESTNET_TOKENS } from '../lib/soroswap';
import { useToast } from '../App';
import type { SwapQuote } from '../lib/soroswap';

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
    <div className="fund-swap-container">
      {xlmBalance && (
        <div className="balance-banner">
          Current Balance: <strong>{parseFloat(xlmBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM</strong>
        </div>
      )}
      {/* Section 1: Friendbot Funding */}
      <div className="card">
        <h3>Fund Wallet (Friendbot)</h3>
        <p className="card-subtitle">
          Get 10,000 XLM on Testnet for free. Use XLM as payment token in escrow deals.
        </p>
        <button
          onClick={handleFundbot}
          disabled={fundingLoading}
          className="btn-primary"
        >
          {fundingLoading ? 'Funding...' : 'Get 10,000 XLM from Friendbot'}
        </button>
        {fundingResult === 'success' && (
          <div className="success-banner fund-success">
            Wallet funded! 10,000 XLM deposited.
            {onFundComplete && (
              <button type="button" onClick={onFundComplete} className="btn-next-step">
                Next: Create a Deal &rarr;
              </button>
            )}
          </div>
        )}
        {fundingResult === 'error' && (
          <div className="info-banner fund-error">
            Wallet already funded! You can proceed to create a deal.
            {onFundComplete && (
              <button type="button" onClick={onFundComplete} className="btn-next-step">
                Continue to Create Deal &rarr;
              </button>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Soroswap Integration */}
      <div className="card">
        <h3>Swap XLM to USDC</h3>
        <p className="card-subtitle">Powered by Soroswap DEX Aggregator</p>

        <div className="info-banner">
          Soroswap testnet liquidity pools may be empty. If quotes fail, use XLM
          directly as payment token when creating deals.
        </div>

        {txHash ? (
          <div className="swap-success">
            <div className="success-icon">&#10003;</div>
            <h4>Swap Successful!</h4>
            <p>
              Swapped {xlmAmount} XLM for{' '}
              {quote ? (parseFloat(quote.amountOut) / 1e7).toFixed(2) : '?'} USDC
            </p>
            <a
              href={getExplorerTxLink(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="explorer-link"
            >
              View on Stellar Explorer
            </a>
            <button
              onClick={() => { setTxHash(''); setQuote(null); setXlmAmount('10'); }}
              className="btn-secondary"
            >
              New Swap
            </button>
          </div>
        ) : (
          <>
            <div className="swap-box">
              <div className="swap-input-group">
                <label>You Pay</label>
                <div className="swap-input-row">
                  <input
                    type="number"
                    value={xlmAmount}
                    onChange={(e) => { setXlmAmount(e.target.value); setQuote(null); }}
                    placeholder="0.0"
                    min="0"
                    step="any"
                  />
                  <span className="token-badge">XLM</span>
                </div>
              </div>

              <div className="swap-arrow">&#8595;</div>

              <div className="swap-input-group">
                <label>You Receive</label>
                <div className="swap-input-row">
                  <input
                    type="text"
                    value={
                      quoteLoading
                        ? 'Loading...'
                        : quote
                          ? (parseFloat(quote.amountOut) / 1e7).toFixed(2)
                          : '—'
                    }
                    readOnly
                    aria-label="USDC amount you receive"
                  />
                  <span className="token-badge usdc">USDC</span>
                </div>
              </div>
            </div>

            {quote && (
              <div className="swap-details">
                <div className="swap-detail-row">
                  <span>Rate</span>
                  <span>
                    1 XLM ={' '}
                    {(
                      parseFloat(quote.amountOut) /
                      1e7 /
                      parseFloat(xlmAmount)
                    ).toFixed(4)}{' '}
                    USDC
                  </span>
                </div>
                <div className="swap-detail-row">
                  <span>Slippage Tolerance</span>
                  <span>1%</span>
                </div>
              </div>
            )}

            {error && <div className="error-message">{error} <button type="button" className="btn-retry" onClick={() => { setError(''); fetchQuote(); }}>Retry</button></div>}

            <div className="swap-actions">
              <button
                onClick={fetchQuote}
                disabled={quoteLoading || !xlmAmount || parseFloat(xlmAmount) <= 0}
                className="btn-secondary"
              >
                {quoteLoading ? 'Getting Quote...' : 'Get Quote'}
              </button>
              <button
                onClick={handleSwap}
                disabled={swapLoading || !quote}
                className="btn-primary btn-swap"
              >
                {swapLoading ? 'Swapping...' : 'Swap XLM for USDC'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
