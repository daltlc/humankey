/**
 * Software FIDO2 authenticator for integration testing.
 * Produces valid WebAuthn registration and authentication responses
 * that pass @simplewebauthn/server's real verification.
 */
import crypto from 'crypto';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import type { CBORType } from '@levischuck/tiny-cbor';

// COSE key type and algorithm constants
const COSE_KTY = 1;    // Key Type
const COSE_ALG = 3;    // Algorithm
const COSE_CRV = -1;   // Curve (for EC)
const COSE_X = -2;     // X coordinate
const COSE_Y = -3;     // Y coordinate
const EC2_KTY = 2;     // Elliptic Curve
const ES256_ALG = -7;  // ECDSA w/ SHA-256
const P256_CRV = 1;    // P-256 curve

interface KeyPair {
  privateKey: crypto.KeyObject;
  publicKeyX: Buffer;
  publicKeyY: Buffer;
}

interface RegisterOptions {
  challenge: string;   // base64url
  rpId: string;
  rpName: string;
  userId: string;      // base64url
  userName: string;
  origin: string;
  aaguid?: string;     // UUID format, defaults to all zeros
}

interface AuthenticateOptions {
  challenge: string;   // base64url
  rpId: string;
  origin: string;
  credentialId: string; // base64url
  counter: number;
}

function base64urlEncode(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer).toString('base64url');
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function sha256(data: Buffer | Uint8Array): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

export class SoftAuthenticator {
  private keyPair: KeyPair | null = null;
  private credentialId: Buffer | null = null;

  private generateKeyPair(): KeyPair {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });

    // Export raw public key to get X and Y coordinates
    const rawPubKey = publicKey.export({ type: 'spki', format: 'der' });
    // For P-256 SPKI, the uncompressed point (04 || x || y) starts at offset 26
    const uncompressedPoint = rawPubKey.subarray(26);
    if (uncompressedPoint[0] !== 0x04) {
      throw new Error('Expected uncompressed point format');
    }
    const publicKeyX = Buffer.from(uncompressedPoint.subarray(1, 33));
    const publicKeyY = Buffer.from(uncompressedPoint.subarray(33, 65));

    return { privateKey, publicKeyX, publicKeyY };
  }

  private encodeCosePublicKey(keyPair: KeyPair): Uint8Array {
    const coseKey = new Map<number, CBORType>();
    coseKey.set(COSE_KTY, EC2_KTY);
    coseKey.set(COSE_ALG, ES256_ALG);
    coseKey.set(COSE_CRV, P256_CRV);
    coseKey.set(COSE_X, new Uint8Array(keyPair.publicKeyX));
    coseKey.set(COSE_Y, new Uint8Array(keyPair.publicKeyY));
    return encodeCBOR(coseKey);
  }

  /**
   * Simulate a FIDO2 registration ceremony.
   * Returns a RegistrationResponseJSON that @simplewebauthn/server can verify.
   */
  register(opts: RegisterOptions) {
    this.keyPair = this.generateKeyPair();
    this.credentialId = crypto.randomBytes(32);

    const rpIdHash = sha256(Buffer.from(opts.rpId));

    // Flags: UP (0x01) + UV (0x04) + AT (0x40) = 0x45
    const flags = Buffer.from([0x45]);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(0);

    // AAGUID (16 bytes)
    const aaguid = opts.aaguid
      ? uuidToBytes(opts.aaguid)
      : Buffer.alloc(16);

    // Credential ID length (2 bytes big-endian)
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(this.credentialId.length);

    // COSE public key
    const coseKey = this.encodeCosePublicKey(this.keyPair);

    // Assemble authenticator data
    const authData = Buffer.concat([
      rpIdHash,         // 32 bytes
      flags,            // 1 byte
      counter,          // 4 bytes
      aaguid,           // 16 bytes
      credIdLen,        // 2 bytes
      this.credentialId, // variable
      coseKey,          // variable
    ]);

    // Create attestation object (fmt: "none" for simplest valid attestation)
    // Must use Map (not plain object) for @levischuck/tiny-cbor compatibility
    const attObjMap = new Map<string, CBORType>([
      ['fmt', 'none'],
      ['attStmt', new Map<string, CBORType>()],
      ['authData', new Uint8Array(authData)],
    ]);
    const attestationObject = encodeCBOR(attObjMap);

    // Create clientDataJSON
    const clientData = {
      type: 'webauthn.create',
      challenge: opts.challenge,
      origin: opts.origin,
      crossOrigin: false,
    };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData));

    return {
      id: base64urlEncode(this.credentialId),
      rawId: base64urlEncode(this.credentialId),
      type: 'public-key' as const,
      response: {
        attestationObject: base64urlEncode(attestationObject),
        clientDataJSON: base64urlEncode(clientDataJSON),
        transports: ['usb' as const],
        publicKeyAlgorithm: -7,
        publicKey: base64urlEncode(
          this.keyPair.publicKey
            ? Buffer.alloc(0) // Not needed for "none" attestation
            : Buffer.alloc(0),
        ),
        authenticatorData: base64urlEncode(authData),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'cross-platform' as const,
    };
  }

  /**
   * Simulate a FIDO2 authentication ceremony.
   * Returns an AuthenticationResponseJSON that @simplewebauthn/server can verify.
   */
  authenticate(opts: AuthenticateOptions) {
    if (!this.keyPair || !this.credentialId) {
      throw new Error('Must register before authenticating');
    }

    const rpIdHash = sha256(Buffer.from(opts.rpId));

    // Flags: UP (0x01) + UV (0x04) = 0x05
    const flags = Buffer.from([0x05]);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(opts.counter);

    const authData = Buffer.concat([rpIdHash, flags, counter]);

    // Create clientDataJSON
    const clientData = {
      type: 'webauthn.get',
      challenge: opts.challenge,
      origin: opts.origin,
      crossOrigin: false,
    };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData));

    // Sign: authData + SHA-256(clientDataJSON)
    const clientDataHash = sha256(clientDataJSON);
    const signedData = Buffer.concat([authData, clientDataHash]);

    const signature = crypto.sign('sha256', signedData, this.keyPair.privateKey);

    return {
      id: base64urlEncode(this.credentialId),
      rawId: base64urlEncode(this.credentialId),
      type: 'public-key' as const,
      response: {
        authenticatorData: base64urlEncode(authData),
        clientDataJSON: base64urlEncode(clientDataJSON),
        signature: base64urlEncode(signature),
        userHandle: '',
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'cross-platform' as const,
    };
  }

  /** Get the credential ID as base64url */
  getCredentialId(): string {
    if (!this.credentialId) throw new Error('Not registered');
    return base64urlEncode(this.credentialId);
  }
}
