// Encryption helpers for private-key storage at rest.
//
// We use AES-256-GCM via Web Crypto. The KEY_ENCRYPTION_KEY env var holds
// a 32-byte base64-encoded master key. Each encrypted blob is stored as
// base64(iv || ciphertext || authTag).
//
// CAUTION:
//   - Rotating KEY_ENCRYPTION_KEY requires a re-encryption pass over all
//     issuer_keys rows. There is no automatic migration.
//   - This is NOT a substitute for HSM/KMS in high-stakes deployments.
//     v0.2 plan: swap encrypt() to wrap KEK via GCP KMS so the master key
//     never sits in plaintext in any process memory.

const ALG = 'AES-GCM';
const IV_BYTES = 12;

function loadKek(): Promise<CryptoKey> {
  const b64 = process.env.KEY_ENCRYPTION_KEY;
  if (!b64) throw new Error('KEY_ENCRYPTION_KEY is not set. See .env.example.');
  const raw = base64ToBytes(b64);
  if (raw.length !== 32) {
    throw new Error(`KEY_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length}).`);
  }
  // Copy into a fresh ArrayBuffer so TS's narrower BufferSource type (which excludes
  // SharedArrayBuffer-backed views) is satisfied. The .buffer of a Uint8Array can be
  // ArrayBufferLike, which includes SharedArrayBuffer in newer lib.dom.d.ts.
  const buf = new Uint8Array(raw).buffer;
  return crypto.subtle.importKey('raw', buf, { name: ALG }, false, ['encrypt', 'decrypt']);
}

let kekPromise: Promise<CryptoKey> | null = null;
function kek() {
  if (!kekPromise) kekPromise = loadKek();
  return kekPromise;
}

export async function encryptBytes(plain: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await kek();
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALG, iv: iv as BufferSource }, key, plain as BufferSource),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return bytesToBase64(out);
}

export async function decryptBytes(blobB64: string): Promise<Uint8Array> {
  const blob = base64ToBytes(blobB64);
  if (blob.length < IV_BYTES + 16) {
    throw new Error('encrypted blob too short');
  }
  const iv = blob.slice(0, IV_BYTES);
  const cipher = blob.slice(IV_BYTES);
  const key = await kek();
  const plain = await crypto.subtle.decrypt(
    { name: ALG, iv: iv as BufferSource },
    key,
    cipher as BufferSource,
  );
  return new Uint8Array(plain);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
