import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Envelope encryption for the few values the application must store and later
 * read back: connector credentials, channel tokens, SCIM tokens
 * (docs/architecture/09 §4).
 *
 * AES-256-GCM with a per-record data key, itself wrapped by a per-environment
 * key-encryption key from the secret store. Two properties matter more than
 * the algorithm choice:
 *
 *   - **The KEK never touches a row.** Each record carries its wrapped DEK and
 *     the KEK version that wrapped it, so rotating the KEK re-wraps the small
 *     DEKs rather than rewriting every ciphertext, and a database dump on its
 *     own decrypts nothing.
 *   - **GCM authenticates.** A tampered ciphertext fails to decrypt rather than
 *     producing plausible garbage, which for a credential means a failed call
 *     rather than a request signed with something an attacker chose.
 *
 * This is deliberately not a general-purpose crypto library. It does one thing,
 * and everything it does not do — key escrow, customer-managed keys (PH-5),
 * signing — belongs elsewhere.
 */

const ALGORITHM = 'aes-256-gcm';
const DEK_BYTES = 32;
const IV_BYTES = 12;

export interface SealedValue {
  /** Base64: the ciphertext. */
  ciphertext: string;
  /** Base64: the nonce. Unique per encryption, never reused with the same key. */
  iv: string;
  /** Base64: the GCM authentication tag. */
  tag: string;
  /** Base64: the data key, wrapped by the KEK. */
  dek: string;
  /** Base64: the nonce used to wrap the data key. */
  dekIv: string;
  /** Base64: the auth tag for the wrapped data key. */
  dekTag: string;
  /** Which KEK wrapped this, so rotation can find what still needs re-wrapping. */
  kekVersion: string;
}

export class CryptoNotConfiguredError extends Error {
  constructor() {
    super(
      'CREDENTIAL_KEK is not set, so encrypted values cannot be read or written. ' +
        'Set it to a base64 32-byte key in this environment.',
    );
  }
}

export class DecryptionFailedError extends Error {
  constructor(reason: string) {
    // Deliberately vague to the caller: a decryption oracle that distinguishes
    // "wrong key" from "tampered ciphertext" is a decryption oracle.
    super(`a stored secret could not be read (${reason})`);
  }
}

interface Kek {
  version: string;
  key: Buffer;
}

/**
 * The key-encryption keys, newest first.
 *
 * `CREDENTIAL_KEK` is the current one and `CREDENTIAL_KEK_PREVIOUS` the one
 * being rotated away from, so a rotation does not have to be simultaneous with
 * re-wrapping every record. The version is a hash of the key rather than a
 * counter somebody has to remember to increment — two environments cannot then
 * disagree about which "v2" they mean.
 */
function loadKeks(env: NodeJS.ProcessEnv = process.env): Kek[] {
  const keks: Kek[] = [];
  for (const name of ['CREDENTIAL_KEK', 'CREDENTIAL_KEK_PREVIOUS']) {
    const raw = env[name];
    if (!raw) continue;
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error(`${name} must be a base64-encoded 32-byte key; this one is ${key.length} bytes`);
    }
    keks.push({ version: versionOf(key), key });
  }
  return keks;
}

function versionOf(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

let cached: Kek[] | undefined;

function keks(): Kek[] {
  if (!cached) cached = loadKeks();
  if (cached.length === 0) throw new CryptoNotConfiguredError();
  return cached;
}

/** Test helper: forget the loaded keys so the environment can change. */
export function resetCrypto(): void {
  cached = undefined;
}

/** Whether encryption is available, for a configuration check that must not throw. */
export function isCryptoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return loadKeks(env).length > 0;
  } catch {
    return false;
  }
}

export function seal(plaintext: string): SealedValue {
  const kek = keks()[0]!;
  const dek = randomBytes(DEK_BYTES);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const dekIv = randomBytes(IV_BYTES);
  const wrapper = createCipheriv(ALGORITHM, kek.key, dekIv);
  const wrappedDek = Buffer.concat([wrapper.update(dek), wrapper.final()]);
  const dekTag = wrapper.getAuthTag();

  // The data key does not outlive this function. Overwriting it is not a
  // guarantee in a garbage-collected runtime, but leaving it is worse.
  dek.fill(0);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    dek: wrappedDek.toString('base64'),
    dekIv: dekIv.toString('base64'),
    dekTag: dekTag.toString('base64'),
    kekVersion: kek.version,
  };
}

export function open(sealed: SealedValue): string {
  // Try the KEK that wrapped it; fall back to the others so a value written
  // before a rotation still reads afterwards.
  const candidates = keks().filter((kek) => kek.version === sealed.kekVersion);
  const tried = candidates.length > 0 ? candidates : keks();

  for (const kek of tried) {
    try {
      const unwrapper = createDecipheriv(ALGORITHM, kek.key, Buffer.from(sealed.dekIv, 'base64'));
      unwrapper.setAuthTag(Buffer.from(sealed.dekTag, 'base64'));
      const dek = Buffer.concat([unwrapper.update(Buffer.from(sealed.dek, 'base64')), unwrapper.final()]);

      const decipher = createDecipheriv(ALGORITHM, dek, Buffer.from(sealed.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');

      dek.fill(0);
      return plaintext;
    } catch {
      // Wrong key, or the value has been altered. Try the next; report the same
      // thing either way.
    }
  }

  throw new DecryptionFailedError('no configured key could read it');
}

/**
 * Which key is current.
 *
 * Exposed so a listing can show "this needs re-wrapping" by comparing versions,
 * without unsealing every stored value to find out — a badge in a table is not
 * worth decrypting every credential in the tenant.
 */
export function currentKekVersion(): string {
  return keks()[0]!.version;
}

/** Whether a stored value needs re-wrapping under the current KEK. */
export function needsRewrap(sealed: SealedValue): boolean {
  return sealed.kekVersion !== keks()[0]!.version;
}

/** Re-wraps under the current KEK, without the plaintext leaving this function. */
export function rewrap(sealed: SealedValue): SealedValue {
  return seal(open(sealed));
}

/**
 * A stable, non-reversible fingerprint of a secret.
 *
 * For showing an operator *which* credential a row holds without showing the
 * credential: "ends …3f9a" is enough to tell two apart and useless to anybody
 * who steals the database.
 */
export function fingerprint(plaintext: string): string {
  return digest(plaintext).slice(-8);
}

/**
 * The whole SHA-256, for binding a secret to a row without storing it: a
 * signed link's token is kept only as this, so a database read cannot answer
 * for the person it was sent to. `fingerprint` is the short form for showing.
 */
export function digest(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** Constant-time comparison, for anywhere a secret is checked rather than used. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
