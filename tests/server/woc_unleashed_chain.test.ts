// The WoC Unleashed claim source keypair loader (server/woc_unleashed_chain.ts):
// fail-closed parsing so a misconfigured deployment refuses claims instead of
// crashing. Never touches the real Solana RPC (loadClaimSourceKeypair is pure).

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { loadClaimSourceKeypair } from '../../server/woc_unleashed_chain';

describe('loadClaimSourceKeypair', () => {
  it('returns null when unset or empty', () => {
    expect(loadClaimSourceKeypair(undefined)).toBeNull();
    expect(loadClaimSourceKeypair('')).toBeNull();
    expect(loadClaimSourceKeypair('   ')).toBeNull();
  });

  it('parses a valid base58 secret key', () => {
    const generated = Keypair.generate();
    const encoded = bs58.encode(generated.secretKey);
    const loaded = loadClaimSourceKeypair(encoded);
    expect(loaded).not.toBeNull();
    expect(loaded?.publicKey.toBase58()).toBe(generated.publicKey.toBase58());
  });

  it('parses a valid JSON byte-array secret key', () => {
    const generated = Keypair.generate();
    const encoded = JSON.stringify(Array.from(generated.secretKey));
    const loaded = loadClaimSourceKeypair(encoded);
    expect(loaded).not.toBeNull();
    expect(loaded?.publicKey.toBase58()).toBe(generated.publicKey.toBase58());
  });

  it('returns null for malformed base58', () => {
    expect(loadClaimSourceKeypair('not-valid-base58!!!')).toBeNull();
  });

  it('returns null for a JSON array of the wrong length', () => {
    expect(loadClaimSourceKeypair(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(loadClaimSourceKeypair('[1, 2,')).toBeNull();
  });
});
