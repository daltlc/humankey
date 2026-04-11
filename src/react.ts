import { useState, useCallback, useRef } from 'react';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { ActionPayload, TapProof, Confirmation, RegistrationResult } from './types.js';
import type { HumanKeyErrorCode } from './errors.js';

/** Status of the humankey flow. */
export type HumanKeyStatus = 'idle' | 'confirming' | 'tapping' | 'verified' | 'error';

/** Error shape returned by the hook. */
export interface HumanKeyHookError {
  message: string;
  code?: HumanKeyErrorCode;
}

/** Configuration for the useHumanKey hook. */
export interface UseHumanKeyConfig {
  /** Relying party ID, e.g. "example.com" */
  rpID: string;
  /** Base URL for humankey API endpoints (default: "/api") */
  apiBase?: string;
}

/** Return value of the useHumanKey hook. */
export interface UseHumanKeyReturn {
  /** Current status of the flow. */
  status: HumanKeyStatus;
  /** The confirmation code the user needs to type (available when status is 'confirming'). */
  confirmationCode: string | null;
  /** Error details (available when status is 'error'). */
  error: HumanKeyHookError | null;
  /** The tap proof (available when status is 'verified'). */
  proof: TapProof | null;

  /** Start a new action — fetches a challenge and generates the confirmation code. */
  startAction: (
    action: ActionPayload,
    credentialIds: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>,
  ) => Promise<void>;

  /** Submit the confirmation code and trigger the hardware key tap. */
  confirmCode: (userInput: string) => Promise<TapProof>;

  /** Register a new hardware key. */
  register: (userName: string) => Promise<RegistrationResult>;

  /** Reset the hook to idle state. */
  reset: () => void;
}

/**
 * React hook for the humankey confirm → tap flow.
 *
 * Usage:
 * ```tsx
 * const { status, confirmationCode, startAction, confirmCode } = useHumanKey({
 *   rpID: 'example.com',
 * });
 *
 * await startAction({ action: 'transfer', data: { amount: 100 } }, [{ id: credId }]);
 * // status → 'confirming', confirmationCode → 'A7X3'
 *
 * const proof = await confirmCode('A7X3');
 * // status → 'tapping' → 'verified'
 * ```
 */
export function useHumanKey(config: UseHumanKeyConfig): UseHumanKeyReturn {
  const { rpID, apiBase = '/api' } = config;

  const [status, setStatus] = useState<HumanKeyStatus>('idle');
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);
  const [error, setError] = useState<HumanKeyHookError | null>(null);
  const [proof, setProof] = useState<TapProof | null>(null);

  // Store flow state between startAction and confirmCode
  const flowRef = useRef<{
    action: ActionPayload;
    confirmation: Confirmation;
    challengeId: string;
    challenge: string;
    credentialIds: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>;
  } | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setConfirmationCode(null);
    setError(null);
    setProof(null);
    flowRef.current = null;
  }, []);

  const startAction = useCallback(
    async (
      action: ActionPayload,
      credentialIds: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>,
    ): Promise<void> => {
      try {
        setStatus('confirming');
        setError(null);
        setProof(null);

        // Fetch challenge from server
        const challengeRes = await fetch(`${apiBase}/challenge`, { method: 'POST' });
        if (!challengeRes.ok) {
          throw new Error('Failed to fetch challenge');
        }
        const { challengeId, challenge } = await challengeRes.json();

        // Import browser SDK dynamically to avoid SSR issues
        const { createConfirmation } = await import('./confirm.js');
        const confirmation = await createConfirmation(action);

        flowRef.current = { action, confirmation, challengeId, challenge, credentialIds };
        setConfirmationCode(confirmation.code);
      } catch (err) {
        setStatus('error');
        setError({
          message: err instanceof Error ? err.message : 'Unknown error',
          code: (err as { code?: HumanKeyErrorCode }).code,
        });
        throw err;
      }
    },
    [apiBase],
  );

  const confirmCode = useCallback(
    async (userInput: string): Promise<TapProof> => {
      const flow = flowRef.current;
      if (!flow) {
        throw new Error('No active action — call startAction first');
      }

      try {
        setStatus('tapping');

        // Import browser SDK dynamically to avoid SSR issues
        const { requestTap } = await import('./tap.js');
        const tapProof = await requestTap({
          challenge: flow.challenge,
          action: flow.action,
          confirmation: flow.confirmation,
          userInput,
          allowCredentials: flow.credentialIds,
          rpID,
        });

        // Send proof to server for verification
        const verifyRes = await fetch(`${apiBase}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proof: tapProof,
            challengeId: flow.challengeId,
            action: flow.action,
          }),
        });

        if (!verifyRes.ok) {
          const errBody = await verifyRes.json().catch(() => ({}));
          throw Object.assign(new Error(errBody.error || 'Verification failed'), {
            code: errBody.code,
          });
        }

        setStatus('verified');
        setProof(tapProof);
        flowRef.current = null;
        return tapProof;
      } catch (err) {
        setStatus('error');
        setError({
          message: err instanceof Error ? err.message : 'Unknown error',
          code: (err as { code?: HumanKeyErrorCode }).code,
        });
        throw err;
      }
    },
    [rpID, apiBase],
  );

  const register = useCallback(
    async (userName: string): Promise<RegistrationResult> => {
      // Fetch challenge
      const challengeRes = await fetch(`${apiBase}/challenge`, { method: 'POST' });
      if (!challengeRes.ok) {
        throw new Error('Failed to fetch challenge');
      }
      const { challengeId, challenge } = await challengeRes.json();

      // Import browser SDK dynamically
      const { registerKey } = await import('./register.js');
      const registration = await registerKey({
        challenge,
        rpID,
        rpName: rpID, // Server validates, this is just a display hint
        userName,
      });

      // Send registration to server
      const regRes = await fetch(`${apiBase}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: registration.response, challengeId }),
      });

      if (!regRes.ok) {
        const errBody = await regRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'Registration failed');
      }

      return registration;
    },
    [rpID, apiBase],
  );

  return {
    status,
    confirmationCode,
    error,
    proof,
    startAction,
    confirmCode,
    register,
    reset,
  };
}

export type { ActionPayload, TapProof, Confirmation, RegistrationResult };
export type { HumanKeyErrorCode };
