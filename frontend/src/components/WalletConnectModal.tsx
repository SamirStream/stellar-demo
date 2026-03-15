/**
 * WalletConnectModal.tsx
 *
 * Unified wallet-connection modal with two tabs:
 *   1. "Email / Social" — Privy embedded wallet (no extension needed)
 *   2. "Extension Wallet" — Freighter / Albedo via StellarWalletsKit
 *
 * The modal closes automatically when the parent detects a successful connection.
 */
import { useState } from 'react';
import { Wallet, Mail, Zap, Chrome, X } from 'lucide-react';

type Tab = 'privy' | 'swk';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  privyLogin: () => void;
  swkConnect: () => Promise<void>;
  onSwkError?: (err: Error) => void;
  isPrivyAppConfigured: boolean;
}

export function WalletConnectModal({
  isOpen,
  onClose,
  privyLogin,
  swkConnect,
  onSwkError,
  isPrivyAppConfigured,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('privy');
  const [swkLoading, setSwkLoading] = useState(false);

  if (!isOpen) return null;

  const handlePrivyLogin = () => {
    privyLogin();
    onClose();
  };

  const handleSwkConnect = async () => {
    setSwkLoading(true);
    try {
      await swkConnect();
      onClose();
    } catch (err: any) {
      onSwkError?.(err);
    } finally {
      setSwkLoading(false);
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Blur backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal panel */}
      <div
        className="relative z-10 w-full max-w-sm bg-[#09090b] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <Wallet size={18} className="text-emerald-400" />
            <span className="font-black text-sm uppercase tracking-widest text-white">
              Connect Wallet
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800/80">
          {[
            { id: 'privy' as Tab, label: 'Email / Social' },
            { id: 'swk' as Tab, label: 'Extension Wallet' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-[11px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6">
          {activeTab === 'privy' && (
            <div className="flex flex-col gap-4">
              {/* Badge */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <Zap size={12} className="text-emerald-400 shrink-0" />
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                  Recommended · No extension needed
                </span>
              </div>

              <p className="text-xs text-zinc-400 leading-relaxed">
                Sign in with email or a social account. Privy creates a
                self-custodial Stellar wallet for you in seconds.
              </p>

              {/* Social method hints */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Google', icon: '🔵' },
                  { label: 'Twitter / X', icon: '⬛' },
                  { label: 'Discord', icon: '🟣' },
                  { label: 'Email OTP', icon: '📧' },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400"
                  >
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>

              {!isPrivyAppConfigured && (
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-medium">
                  ⚠ Set <code className="font-mono">VITE_PRIVY_APP_ID</code> in{' '}
                  <code className="font-mono">.env</code> to enable this.
                </div>
              )}

              <button
                onClick={handlePrivyLogin}
                disabled={!isPrivyAppConfigured}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-[#010205] font-black text-sm uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]"
              >
                <Mail size={15} />
                Continue with Privy
              </button>
            </div>
          )}

          {activeTab === 'swk' && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Connect with a browser extension wallet. Freighter or Albedo
                must be installed.
              </p>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Freighter', desc: 'Extension', icon: '🚀' },
                  { label: 'Albedo', desc: 'Web-based', icon: '🌐' },
                ].map((w) => (
                  <div
                    key={w.label}
                    className="flex flex-col gap-1 px-3 py-3 rounded-lg bg-zinc-900 border border-zinc-800"
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-300 font-bold">
                      <span>{w.icon}</span>
                      <span>{w.label}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500">{w.desc}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleSwkConnect}
                disabled={swkLoading}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm uppercase tracking-widest border border-zinc-700 hover:border-zinc-600 transition-all"
              >
                <Chrome size={15} />
                {swkLoading ? 'Opening wallet…' : 'Connect Extension'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
