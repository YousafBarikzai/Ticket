import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CryptoNotConfiguredError,
  DecryptionFailedError,
  fingerprint,
  isCryptoConfigured,
  needsRewrap,
  open,
  resetCrypto,
  rewrap,
  seal,
  secretsMatch,
} from '../crypto.js';

/**
 * These check the properties that make the scheme worth having, not that
 * AES works. The interesting question for a credential store is what happens
 * when something goes wrong: a rotated key, an altered row, a missing key.
 */

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

beforeEach(() => {
  process.env.CREDENTIAL_KEK = KEY_A;
  delete process.env.CREDENTIAL_KEK_PREVIOUS;
  resetCrypto();
});

afterEach(() => {
  delete process.env.CREDENTIAL_KEK;
  delete process.env.CREDENTIAL_KEK_PREVIOUS;
  resetCrypto();
});

describe('sealing a secret', () => {
  it('round-trips', () => {
    const sealed = seal('pk_live_notarealkey');
    expect(open(sealed)).toBe('pk_live_notarealkey');
  });

  it('never puts the plaintext in the stored value', () => {
    // The row goes in a database, a backup and a dump. Any of those leaking
    // must not leak the credential.
    const sealed = seal('pk_live_notarealkey');
    expect(JSON.stringify(sealed)).not.toContain('notarealkey');
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain('notarealkey');
  });

  it('produces a different ciphertext each time for the same input', () => {
    // A deterministic ciphertext would tell an observer which two tenants use
    // the same credential.
    const a = seal('same-secret');
    const b = seal('same-secret');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.dek).not.toBe(b.dek);
    expect(open(a)).toBe(open(b));
  });

  it('refuses a key that is not 32 bytes rather than padding it', () => {
    process.env.CREDENTIAL_KEK = Buffer.alloc(16, 1).toString('base64');
    resetCrypto();
    expect(() => seal('x')).toThrow(/32-byte key/);
  });

  it('says plainly when no key is configured', () => {
    delete process.env.CREDENTIAL_KEK;
    resetCrypto();
    expect(() => seal('x')).toThrow(CryptoNotConfiguredError);
    expect(isCryptoConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('when something is wrong', () => {
  it('refuses an altered ciphertext rather than returning plausible garbage', () => {
    // GCM authenticates. For a credential this is the difference between a
    // failed call and a request signed with something an attacker chose.
    const sealed = seal('pk_live_notarealkey');
    const altered = { ...sealed, ciphertext: Buffer.from('not the same length!!').toString('base64') };
    expect(() => open(altered)).toThrow(DecryptionFailedError);
  });

  it('refuses an altered wrapped key', () => {
    const sealed = seal('pk_live_notarealkey');
    const altered = { ...sealed, dek: Buffer.alloc(48, 9).toString('base64') };
    expect(() => open(altered)).toThrow(DecryptionFailedError);
  });

  it('does not say whether the key was wrong or the value was tampered with', () => {
    // A decryption oracle that distinguishes the two is a decryption oracle.
    const sealed = seal('secret');
    process.env.CREDENTIAL_KEK = KEY_B;
    resetCrypto();

    let wrongKey = '';
    try {
      open(sealed);
    } catch (error) {
      wrongKey = (error as Error).message;
    }

    process.env.CREDENTIAL_KEK = KEY_A;
    resetCrypto();
    let tampered = '';
    try {
      open({ ...seal('secret'), tag: Buffer.alloc(16, 7).toString('base64') });
    } catch (error) {
      tampered = (error as Error).message;
    }

    expect(wrongKey).toBe(tampered);
  });
});

describe('rotating the key', () => {
  it('still reads a value written under the previous key', () => {
    // A rotation must not need every record re-wrapped in the same instant.
    const sealed = seal('written-before-rotation');

    process.env.CREDENTIAL_KEK = KEY_B;
    process.env.CREDENTIAL_KEK_PREVIOUS = KEY_A;
    resetCrypto();

    expect(open(sealed)).toBe('written-before-rotation');
  });

  it('knows which values still need re-wrapping', () => {
    const sealed = seal('written-before-rotation');
    expect(needsRewrap(sealed)).toBe(false);

    process.env.CREDENTIAL_KEK = KEY_B;
    process.env.CREDENTIAL_KEK_PREVIOUS = KEY_A;
    resetCrypto();

    expect(needsRewrap(sealed)).toBe(true);
    const fresh = rewrap(sealed);
    expect(needsRewrap(fresh)).toBe(false);
    expect(open(fresh)).toBe('written-before-rotation');
  });

  it('stops reading old values once the previous key is withdrawn', () => {
    // The point of finishing a rotation.
    const sealed = seal('written-before-rotation');
    process.env.CREDENTIAL_KEK = KEY_B;
    delete process.env.CREDENTIAL_KEK_PREVIOUS;
    resetCrypto();
    expect(() => open(sealed)).toThrow(DecryptionFailedError);
  });
});

describe('showing a credential without showing it', () => {
  it('fingerprints stably, and reveals nothing', () => {
    expect(fingerprint('pk_live_notarealkey')).toBe(fingerprint('pk_live_notarealkey'));
    expect(fingerprint('pk_live_notarealkey')).not.toBe(fingerprint('pk_live_anotherkey'));
    expect(fingerprint('pk_live_notarealkey')).toHaveLength(8);
    expect(fingerprint('pk_live_notarealkey')).not.toContain('notarealkey');
  });

  it('compares secrets without leaking the answer through timing', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('abc', 'abcd')).toBe(false);
  });
});
