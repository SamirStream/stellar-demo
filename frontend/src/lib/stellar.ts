import * as StellarSdk from '@stellar/stellar-sdk';

// Access rpc namespace directly — stellar-base is pinned at 14.1.0 via package.json overrides,
// so the dual-class mismatch is already resolved and the any cast is unnecessary.
const SorobanRpc = StellarSdk.rpc;

// Testnet configuration
export const NETWORK = 'TESTNET';
export const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
export const SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';
export const EXPLORER_URL = 'https://stellar.expert/explorer/testnet';

// XLM Native SAC (Stellar Asset Contract) — wraps native XLM for Soroban
export const XLM_SAC_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// USDC Testnet token address (Soroswap testnet USDC)
export const USDC_TOKEN_ADDRESS = import.meta.env.VITE_USDC_TOKEN_ADDRESS || '';

// DealEscrow contract address (set after deployment)
export const DEAL_ESCROW_CONTRACT = import.meta.env.VITE_DEAL_ESCROW_CONTRACT || '';

// Demo testnet accounts
export const DEMO_ACCOUNTS = {
  provider: 'GBGAYFBHEW75IV3M4ISWZ5OYCC6RWJBW6F5OB5CWVPFOPUES6MSKZ52I',
  connector: 'GBH6SRZUJMYVHDRZKF3LCSOAKIINO3VNFJRK7JDNSUW4DIFFATKI7WSS',
  platform: 'GANINT77BUNZNNNIVU4BCZFDA6IBDDQO2IU7MXLNQBLEIL2ZFD45C2OB',
};

// Token metadata
export const TOKENS: Record<string, { name: string; symbol: string; decimals: number; address: string }> = {
  XLM: { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7, address: XLM_SAC_ADDRESS },
  USDC: { name: 'USD Coin', symbol: 'USDC', decimals: 7, address: USDC_TOKEN_ADDRESS },
};

// Resolve token symbol from contract address
export function getTokenSymbol(address: string): string {
  for (const t of Object.values(TOKENS)) {
    if (t.address === address) return t.symbol;
  }
  return 'TOKEN';
}

// Soroban RPC Server
export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

// Horizon Server
export const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);

// Fund a testnet account via Friendbot
export async function fundTestnetAccount(address: string): Promise<boolean> {
  try {
    const response = await fetch(`${FRIENDBOT_URL}?addr=${address}`);
    return response.ok;
  } catch {
    return false;
  }
}

// Get XLM balance for an address
export async function getXlmBalance(address: string): Promise<string> {
  try {
    const account = await horizonServer.loadAccount(address);
    const native = account.balances.find(
      (b: any) => b.asset_type === 'native'
    );
    return native ? native.balance : '0';
  } catch {
    return '0';
  }
}

// Get token balance via Soroban
export async function getTokenBalance(
  tokenAddress: string,
  accountAddress: string
): Promise<string> {
  try {
    const contract = new StellarSdk.Contract(tokenAddress);
    const address = new StellarSdk.Address(accountAddress);

    const tx = new StellarSdk.TransactionBuilder(
      await sorobanServer.getAccount(accountAddress),
      {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      }
    )
      .addOperation(contract.call('balance', address.toScVal()))
      .setTimeout(30)
      .build();

    const result = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result) {
      return StellarSdk.scValToNative(result.result.retval).toString();
    }
    return '0';
  } catch {
    return '0';
  }
}

// Format token amount (7 decimals for Stellar)
export function formatAmount(amount: string | number, decimals = 7): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return (num / Math.pow(10, decimals)).toFixed(2);
}

// Parse human-readable amount to contract units (7 decimals)
export function toContractAmount(humanAmount: number, decimals = 7): bigint {
  return BigInt(Math.round(humanAmount * Math.pow(10, decimals)));
}

// Get explorer link for a transaction
export function getExplorerTxLink(txHash: string): string {
  return `${EXPLORER_URL}/tx/${txHash}`;
}

// Get explorer link for a contract
export function getExplorerContractLink(contractId: string): string {
  return `${EXPLORER_URL}/contract/${contractId}`;
}

// Get explorer link for an account/wallet
export function getExplorerAccountLink(address: string): string {
  return `${EXPLORER_URL}/account/${address}`;
}

// Truncate address for display
export function truncateAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Validate a Stellar public key (G... address, 56 chars, base32)
export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address.trim());
}
