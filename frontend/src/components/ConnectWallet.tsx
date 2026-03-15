import { truncateAddress } from '../lib/stellar';
import type { WalletState } from '../hooks/useStellarWallet';
import { Button } from './ui/Components';
import { Wallet } from 'lucide-react';

interface Props {
  wallet: WalletState;
}

export function ConnectWallet({ wallet }: Props) {
  if (!wallet.isConnected) {
    return (
      <Button
        onClick={wallet.connect}
        variant="primary"
        className="px-6 py-2.5 text-sm"
        icon={Wallet}
      >
        Connect Wallet
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-4 bg-[#09090b] border border-zinc-800/80 rounded-2xl pl-5 pr-1.5 py-1.5 shadow-xl">
      <div className="flex flex-col items-end">
        <span className="text-xs font-mono text-emerald-400 font-bold">
          {parseFloat(wallet.xlmBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM
        </span>
        {wallet.usdcBalance !== '0' && (
          <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">
            {wallet.usdcBalance} USDC
          </span>
        )}
      </div>
      <div
        onClick={wallet.disconnect}
        title="Click to disconnect"
        className="bg-[#02040a] text-emerald-100 text-xs font-mono font-bold px-4 py-3 rounded-xl border border-zinc-800 hover:border-red-500/50 hover:text-red-400 cursor-pointer transition-all shadow-[inset_0_0_10px_rgba(16,185,129,0.05)] flex items-center gap-2"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
        {truncateAddress(wallet.address)}
      </div>
    </div>
  );
}
