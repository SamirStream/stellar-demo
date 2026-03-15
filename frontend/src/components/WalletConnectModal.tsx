/**
 * WalletConnectModal.tsx
 *
 * Unified wallet-connection modal with two tabs:
 *   1. "Email / Social" — Privy embedded wallet (no extension needed)
 *   2. "Extension Wallet" — Freighter / Albedo via StellarWalletsKit
 *
 * Each social provider button calls useLoginWithOAuth({ provider }) directly
 * from our own window context (NOT from inside Privy's iframe) — this is
 * required for popup-based OAuth to work on Firefox and Chrome, since popups
 * opened from within iframes are silently blocked by browsers.
 *
 * Email OTP uses useLoginWithEmail and never needs a popup at all.
 */
import { useState } from 'react';
import { useLoginWithOAuth, useLoginWithEmail } from '@privy-io/react-auth';
import type { OAuthProviderType } from '@privy-io/react-auth';
import { Wallet, Mail, Chrome, X, Zap, ArrowRight, Loader2 } from 'lucide-react';

type Tab = 'privy' | 'swk';
type OAuthProvider = Extract<OAuthProviderType, 'google' | 'twitter' | 'discord'>;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  swkConnect: () => Promise<void>;
  onSwkError?: (err: Error) => void;
  isPrivyAppConfigured: boolean;
}

// SVG icons for social providers
const ProviderIcon = ({ provider }: { provider: OAuthProvider }) => {
  if (provider === 'google') return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
  if (provider === 'twitter') return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.105 18.101.12 18.14.143 18.17a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
    </svg>
  );
};

export function WalletConnectModal({
  isOpen,
  onClose,
  swkConnect,
  onSwkError,
  isPrivyAppConfigured,
}: Props) {
  // All hooks must be called before any early return (React rules)
  const [activeTab, setActiveTab] = useState<Tab>('privy');
  const [swkLoading, setSwkLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [emailStep, setEmailStep] = useState<'input' | 'code'>('input');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [oauthError, setOauthError] = useState('');

  // OAuth: each provider button calls initOAuth directly from THIS window (not iframe)
  const { initOAuth } = useLoginWithOAuth({
    onComplete: () => onClose(),
    onError: (err) => {
      setOauthLoading(null);
      setOauthError(err ?? 'OAuth login failed.');
    },
  });

  // Email OTP: no popup needed, works everywhere
  const { sendCode, loginWithCode } = useLoginWithEmail({
    onComplete: () => onClose(),
    onError: (err) => {
      setEmailError(err ?? 'Something went wrong — please try again.');
      setEmailLoading(false);
    },
  });

  if (!isOpen) return null;

  const handleOAuth = async (provider: OAuthProvider) => {
    if (!isPrivyAppConfigured || oauthLoading) return;
    setOauthError('');
    setOauthLoading(provider);
    try {
      await initOAuth({ provider });
    } catch {
      setOauthLoading(null);
    }
  };

  const handleSendCode = async () => {
    if (!email.trim()) return;
    setEmailError('');
    setEmailLoading(true);
    try {
      await sendCode({ email: email.trim() });
      setEmailStep('code');
    } catch {
      // handled by onError
    } finally {
      setEmailLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) return;
    setEmailError('');
    setEmailLoading(true);
    try {
      await loginWithCode({ code: code.trim() });
    } catch {
      // handled by onError
    } finally {
      setEmailLoading(false);
    }
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

  const oauthProviders: { provider: OAuthProvider; label: string }[] = [
    { provider: 'google',  label: 'Google'    },
    { provider: 'twitter', label: 'X (Twitter)' },
    { provider: 'discord', label: 'Discord'   },
  ];

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
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
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-500 hover:text-white transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800/80">
          {[
            { id: 'privy' as Tab, label: 'Email / Social' },
            { id: 'swk'   as Tab, label: 'Extension Wallet' },
          ].map((tab) => (
            <button
              type="button"
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

        {/* ── TAB 1: Privy ── */}
        {activeTab === 'privy' && (
          <div className="p-6 flex flex-col gap-4">
            {/* Badge */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Zap size={12} className="text-emerald-400 shrink-0" />
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                No extension needed · Embedded wallet
              </span>
            </div>

            {!isPrivyAppConfigured && (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-medium">
                ⚠ <code className="font-mono">VITE_PRIVY_APP_ID</code> not set in{' '}
                <code className="font-mono">.env</code>
              </div>
            )}

            {/* Social OAuth buttons — each calls initOAuth directly from main window */}
            <div className="flex flex-col gap-2">
              {oauthProviders.map(({ provider, label }) => (
                <button
                  type="button"
                  key={provider}
                  onClick={() => handleOAuth(provider)}
                  disabled={!isPrivyAppConfigured || !!oauthLoading}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all"
                >
                  {oauthLoading === provider
                    ? <Loader2 size={16} className="animate-spin text-emerald-400 shrink-0" />
                    : <ProviderIcon provider={provider} />
                  }
                  <span>Continue with {label}</span>
                  {oauthLoading !== provider && (
                    <ArrowRight size={14} className="ml-auto text-zinc-600" />
                  )}
                </button>
              ))}
            </div>
            {oauthError && (
              <p className="text-[11px] text-red-400 px-1">{oauthError}</p>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">or</span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>

            {/* Email OTP */}
            {emailStep === 'input' ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                    placeholder="ton@email.com"
                    disabled={!isPrivyAppConfigured || emailLoading}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 disabled:opacity-40 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={!isPrivyAppConfigured || emailLoading || !email.trim()}
                    className="px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 text-white"
                  >
                    {emailLoading
                      ? <Loader2 size={15} className="animate-spin" />
                      : <><Mail size={15} /><ArrowRight size={13} /></>
                    }
                  </button>
                </div>
                {emailError && (
                  <p className="text-[11px] text-red-400 px-1">{emailError}</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-zinc-500 px-1">
                  Code sent to <span className="text-zinc-300 font-mono">{email}</span>
                  {' '}—{' '}
                  <button
                    type="button"
                    onClick={() => { setEmailStep('input'); setCode(''); setEmailError(''); }}
                    className="text-emerald-500 hover:underline"
                  >
                    change
                  </button>
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                    placeholder="123456"
                    maxLength={6}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 font-mono tracking-widest transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyCode}
                    disabled={emailLoading || !code.trim()}
                    className="px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 text-[#010205] font-bold"
                  >
                    {emailLoading
                      ? <Loader2 size={15} className="animate-spin" />
                      : <ArrowRight size={15} />
                    }
                  </button>
                </div>
                {emailError && (
                  <p className="text-[11px] text-red-400 px-1">{emailError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: Extension Wallet ── */}
        {activeTab === 'swk' && (
          <div className="p-6 flex flex-col gap-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Connect using a browser extension. Freighter or Albedo must be installed.
            </p>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Freighter', desc: 'Extension', icon: '🚀' },
                { label: 'Albedo',    desc: 'Web-based',  icon: '🌐' },
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
              type="button"
              onClick={handleSwkConnect}
              disabled={swkLoading}
              className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm uppercase tracking-widest border border-zinc-700 hover:border-zinc-600 transition-all"
            >
              {swkLoading
                ? <Loader2 size={15} className="animate-spin" />
                : <Chrome size={15} />
              }
              {swkLoading ? 'Opening wallet…' : 'Connect Extension'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
