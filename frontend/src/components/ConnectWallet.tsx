import { truncateAddress } from '../lib/stellar';
import type { WalletState } from '../hooks/useStellarWallet';

interface Props {
  wallet: WalletState;
}

export function ConnectWallet({ wallet }: Props) {
  if (!wallet.isConnected) {
    return (
      <button
        onClick={wallet.connect}
        className="connect-btn"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="wallet-info">
      <div className="wallet-address">
        <span className="dot green" />
        {truncateAddress(wallet.address)}
      </div>
      <div className="wallet-balances">
        <span>{parseFloat(wallet.xlmBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM</span>
        {wallet.usdcBalance !== '0' && (
          <span>{wallet.usdcBalance} USDC</span>
        )}
      </div>
      <button onClick={wallet.disconnect} className="disconnect-btn">
        Disconnect
      </button>
    </div>
  );
}
