import { describe, it, expect, vi } from 'vitest';
import { verifyRegistration } from '../src/registration-verify.js';
import { HumanKeyError } from '../src/errors.js';

vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn(),
}));

import { verifyRegistrationResponse } from '@simplewebauthn/server';
const mockVerify = vi.mocked(verifyRegistrationResponse);

describe('verifyRegistration', () => {
  const baseRequest = {
    response: {} as Parameters<typeof verifyRegistration>[0]['response'],
    expectedChallenge: 'test-challenge',
    expectedOrigin: 'https://example.com',
    expectedRPID: 'example.com',
  };

  it('returns a TapCredential on successful verification', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        fmt: 'packed',
        aaguid: 'test-aaguid',
        credential: {
          id: 'cred-123',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ['usb'],
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'https://example.com',
        rpID: 'example.com',
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const result = await verifyRegistration(baseRequest);

    expect(result.verified).toBe(true);
    expect(result.credential.id).toBe('cred-123');
    expect(result.credential.publicKey).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(result.credential.counter).toBe(0);
    expect(result.credential.deviceType).toBe('singleDevice');
    expect(result.credential.backedUp).toBe(false);
    expect(result.credential.aaguid).toBe('test-aaguid');
  });

  it('throws REGISTRATION_FAILED when verification fails', async () => {
    mockVerify.mockRejectedValueOnce(new Error('Invalid attestation'));

    await expect(verifyRegistration(baseRequest)).rejects.toThrow(HumanKeyError);

    mockVerify.mockRejectedValueOnce(new Error('Invalid attestation'));
    try {
      await verifyRegistration(baseRequest);
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('REGISTRATION_FAILED');
    }
  });

  it('throws REGISTRATION_FAILED when verified is false', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: false,
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    await expect(verifyRegistration(baseRequest)).rejects.toThrow(HumanKeyError);
  });

  it('allows registration when AAGUID is in allowedAAGUIDs', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        fmt: 'packed',
        aaguid: 'yubikey-5-nfc',
        credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0, transports: ['usb'] },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'https://example.com',
        rpID: 'example.com',
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const result = await verifyRegistration({
      ...baseRequest,
      allowedAAGUIDs: ['yubikey-5-nfc', 'yubikey-5c'],
    });

    expect(result.verified).toBe(true);
    expect(result.credential.aaguid).toBe('yubikey-5-nfc');
  });

  it('throws AAGUID_NOT_ALLOWED when AAGUID is not in allowedAAGUIDs', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        fmt: 'packed',
        aaguid: 'unknown-authenticator',
        credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0, transports: ['usb'] },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'https://example.com',
        rpID: 'example.com',
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    try {
      await verifyRegistration({
        ...baseRequest,
        allowedAAGUIDs: ['yubikey-5-nfc'],
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('AAGUID_NOT_ALLOWED');
    }
  });

  it('skips AAGUID check when allowedAAGUIDs is undefined', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        fmt: 'packed',
        aaguid: 'any-aaguid',
        credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0, transports: ['usb'] },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'https://example.com',
        rpID: 'example.com',
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const result = await verifyRegistration(baseRequest);
    expect(result.verified).toBe(true);
  });

  it('defaults requireUserVerification to true', async () => {
    mockVerify.mockRejectedValueOnce(new Error('fail'));

    try {
      await verifyRegistration(baseRequest);
    } catch {
      // expected
    }

    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true }),
    );
  });
});
