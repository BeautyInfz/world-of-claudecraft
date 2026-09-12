// The on-chain half of the WoC Unleashed claim flow: builds, signs, and sends
// the ONE atomic transaction a successful claim executes (transfer 80% to the
// player, transfer 10% to treasury, burn 10% - all from the claim source
// wallet's own $WOC token account). WoC Unleashed-exclusive; nothing here is
// called unless server/woc_unleashed_claim.ts's gate checks already passed.
//
// TESTING-ONLY CUSTODY MODEL: the claim source wallet is a raw keypair loaded
// from an env var on THIS process, not a program-owned PDA. The WoC Unleashed
// spec is explicit that this is acceptable for a first pass but MUST become
// program-owned custody before handling real user funds at scale - flagged
// here again, at the one place the raw key is actually used, so it cannot be
// missed. Never commit a real secret key; WOC_UNLEASHED_CLAIM_SECRET_KEY is
// unset in every checked-in .env.example.
//
// Chain-adapter seam: every export here takes a Connection/Keypair as a
// parameter or reads them from a swappable getter, so tests can inject a fake
// (no real RPC/signing) and exercise the claim flow's OWN logic (gate order,
// atomicity, ledger recording) without touching Solana at all.

import {
  createBurnInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const WOC_MINT = (
  process.env.WOC_MINT ??
  process.env.VITE_WOC_MINT ??
  '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();
const SOLANA_RPC_URL = (
  process.env.SOLANA_RPC_URL ??
  process.env.VITE_SOLANA_RPC_URL ??
  'https://api.mainnet-beta.solana.com'
).trim();

// The spec's fixed treasury destination (server/woc_unleashed.ts style
// constant: a real value, not an env override, since it names a specific
// program-external wallet the spec pins by address).
export const WOC_UNLEASHED_TREASURY_WALLET = 'FAH753SAV5wKGTZpyvqhWNwwCtif8h28uW2oSskNJeF2';
export const WOC_UNLEASHED_CLAIM_SOURCE_WALLET = 'AG2LyzSeGWbwomNHk6dXhH6fZYPXSM9suLBdCiDuDSW1';

let cachedConnection: Connection | null = null;
function connection(): Connection {
  if (!cachedConnection) cachedConnection = new Connection(SOLANA_RPC_URL, 'confirmed');
  return cachedConnection;
}

/** Parse WOC_UNLEASHED_CLAIM_SECRET_KEY: either a base58-encoded 64-byte
 *  secret key (the Phantom/Solflare export format) or a JSON `[n, n, ...]`
 *  byte array (the `solana-keygen` file format), matching the two shapes a
 *  real operator's key management is likely to produce. Returns null (rather
 *  than throwing) on anything unset/malformed, so a misconfigured deployment
 *  fails the claim closed instead of crashing the process. */
export function loadClaimSourceKeypair(raw: string | undefined): Keypair | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('[')) {
      const bytes = Uint8Array.from(JSON.parse(trimmed));
      if (bytes.length !== 64) return null;
      return Keypair.fromSecretKey(bytes);
    }
    const bytes = bs58.decode(trimmed);
    if (bytes.length !== 64) return null;
    return Keypair.fromSecretKey(bytes);
  } catch {
    return null;
  }
}

function claimSourceKeypair(): Keypair | null {
  return loadClaimSourceKeypair(process.env.WOC_UNLEASHED_CLAIM_SECRET_KEY);
}

export interface ClaimTransactionParams {
  /** The claiming player's linked wallet (server/wallet_link.ts), receives 80%. */
  destinationOwner: string;
  /** Gross amount claimed, in the mint's base units (the raw on-chain integer,
   *  already scaled by the token's decimals - the caller owns that math). */
  grossBaseUnits: bigint;
}

export interface ClaimTransactionResult {
  signature: string;
  transferredBaseUnits: bigint;
  treasuryBaseUnits: bigint;
  burnedBaseUnits: bigint;
}

/** Builds and sends the ONE atomic claim transaction: transfer 80% to the
 *  player, transfer 10% to treasury, burn 10% from the claim source's own
 *  token account. All three instructions ride the SAME transaction, so a
 *  failure before confirmation leaves NONE of them applied on-chain (Solana
 *  transactions are all-or-nothing) - no partial payout, no partial burn.
 *  Throws when the claim source keypair is unset/malformed (fails closed)
 *  or on any RPC/send failure; the caller (woc_unleashed_claim.ts) is
 *  responsible for the off-chain compensating action on failure. */
export async function executeClaimTransaction(
  params: ClaimTransactionParams,
): Promise<ClaimTransactionResult> {
  const payer = claimSourceKeypair();
  if (!payer) {
    throw new Error('WOC_UNLEASHED_CLAIM_SECRET_KEY is unset or malformed; claim refused');
  }
  const mint = new PublicKey(WOC_MINT);
  const destination = new PublicKey(params.destinationOwner);
  const treasury = new PublicKey(WOC_UNLEASHED_TREASURY_WALLET);

  // 80 / 10 / 10 split (spec-fixed). Integer division with the remainder
  // folded into the transfer leg (never the burn leg): a player must never
  // receive LESS than the advertised 80% due to rounding, and the burn
  // amount staying exact-or-smaller is the conservative rounding direction
  // for a supply-reduction action.
  const treasuryBaseUnits = params.grossBaseUnits / 10n;
  const burnBaseUnits = params.grossBaseUnits / 10n;
  const transferBaseUnits = params.grossBaseUnits - treasuryBaseUnits - burnBaseUnits;

  const sourceAta = await getAssociatedTokenAddress(mint, payer.publicKey);
  const destinationAta = await getAssociatedTokenAddress(mint, destination);
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);

  const tx = new Transaction().add(
    createTransferInstruction(sourceAta, destinationAta, payer.publicKey, transferBaseUnits),
    createTransferInstruction(sourceAta, treasuryAta, payer.publicKey, treasuryBaseUnits),
    createBurnInstruction(sourceAta, mint, payer.publicKey, burnBaseUnits),
  );

  const signature = await sendAndConfirmTransaction(connection(), tx, [payer], {
    commitment: 'confirmed',
  });

  return {
    signature,
    transferredBaseUnits: transferBaseUnits,
    treasuryBaseUnits,
    burnedBaseUnits: burnBaseUnits,
  };
}

let cachedMintDecimals: number | null = null;

/** The $WOC mint's decimals, read from the chain once and cached (a token's
 *  decimals are fixed at mint creation, never change). Used to convert a
 *  human $WOC amount to the raw base-unit integer every SPL instruction
 *  actually requires. */
export async function wocMintDecimals(): Promise<number> {
  if (cachedMintDecimals !== null) return cachedMintDecimals;
  const info = await getMint(connection(), new PublicKey(WOC_MINT));
  cachedMintDecimals = info.decimals;
  return cachedMintDecimals;
}

/** Test-only: reset the cached mint decimals. */
export function resetWocMintDecimalsForTests(): void {
  cachedMintDecimals = null;
}

/** human $WOC amount -> the mint's raw base-unit integer, floored (a claim
 *  must never round UP into an amount the source wallet cannot cover). */
export function wocToBaseUnits(amountWoc: number, decimals: number): bigint {
  const scaled = Math.floor(amountWoc * 10 ** decimals);
  return BigInt(Math.max(0, scaled));
}

/** The claim source wallet's own remaining $WOC balance (the wallet panel's
 *  "claim wallet reserve" readout, item 5 of the spec - visible without
 *  connecting a wallet). Reuses fetchWocBalance's exact RPC/parse path
 *  (server/woc_balance.ts) rather than re-implementing it. */
export { fetchWocBalance as claimWalletReserve } from './woc_balance';
