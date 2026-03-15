const API_BASE = 'https://api.soroswap.finance';
const API_KEY = import.meta.env.VITE_SOROSWAP_API_KEY || '';
const NETWORK = 'testnet';

// Known testnet token addresses
export const TESTNET_TOKENS = {
  XLM: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  USDC: import.meta.env.VITE_USDC_TOKEN_ADDRESS || '',
};

export interface SwapQuote {
  amountIn: string;
  amountOut: string;
  priceImpact: string;
  route: any[];
  rawQuote: any;
}

export class SoroswapClient {
  private apiKey: string;
  private network: string;

  constructor(apiKey?: string, network?: string) {
    this.apiKey = apiKey || API_KEY;
    this.network = network || NETWORK;
  }

  private async apiRequest(endpoint: string, data: any): Promise<any> {
    const url = `${API_BASE}${endpoint}?network=${this.network}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      const msg = error.detail || error.title || error.error || error.message || response.statusText;
      throw new Error(`Soroswap API error: ${msg}`);
    }
    return response.json();
  }

  // Step 1: Get a swap quote
  async getQuote(
    assetIn: string,
    assetOut: string,
    amount: string,
    tradeType: 'EXACT_IN' | 'EXACT_OUT' = 'EXACT_IN'
  ): Promise<SwapQuote> {
    const result = await this.apiRequest('/quote', {
      assetIn,
      assetOut,
      amount,
      tradeType,
      protocols: ['soroswap', 'phoenix', 'aqua'],
      slippageBps: 100, // 1% slippage
    });

    return {
      amountIn: result.amountIn || amount,
      amountOut: result.amountOut || '0',
      priceImpact: result.priceImpact || '0',
      route: result.route || [],
      rawQuote: result,
    };
  }

  // Step 2: Build a signable transaction
  async buildTransaction(
    quote: any,
    fromAddress: string,
    toAddress?: string
  ): Promise<string> {
    const result = await this.apiRequest('/quote/build', {
      quote: quote.rawQuote || quote,
      from: fromAddress,
      to: toAddress || fromAddress,
    });

    return result.xdr;
  }

  // Step 3: Send signed transaction
  async sendTransaction(signedXdr: string): Promise<{ txHash: string }> {
    const result = await this.apiRequest('/send', {
      xdr: signedXdr,
      launchtube: false,
    });

    return { txHash: result.txHash || result.hash || '' };
  }
}

export const soroswapClient = new SoroswapClient();
