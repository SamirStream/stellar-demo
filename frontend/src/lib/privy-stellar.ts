/**
 * privy-stellar.ts
 *
 * Bridge between Privy's raw signing API (Ed25519 hash-based) and Stellar
 * transaction envelopes. Privy signs the raw transaction hash; we then inject
 * the returned signature into the XDR envelope before submission.
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from './stellar';

/**
 * Returns the 0x-prefixed hex hash that Privy must sign for a Stellar transaction.
 * This is the SHA-256(network_passphrase + tx_hash) — computed by tx.hash() in the SDK.
 */
export function getStellarTxHash(xdr: string): string {
  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  return '0x' + Buffer.from(tx.hash()).toString('hex');
}

/**
 * Injects a Privy-produced Ed25519 signature into a Stellar transaction XDR
 * and returns the fully-signed base64 envelope ready for submission.
 */
export function assembleStellarSignedTx(
  xdr: string,
  publicKey: string,
  signatureHex: string // 0x-prefixed hex from Privy signRawHash
): string {
  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
  const sigBytes = Buffer.from(
    signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex,
    'hex'
  );
  const decoratedSig = new StellarSdk.xdr.DecoratedSignature({
    hint: keypair.signatureHint(),
    signature: sigBytes,
  });
  tx.signatures.push(decoratedSig);
  return tx.toEnvelope().toXDR('base64');
}
