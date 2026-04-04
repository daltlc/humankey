import {
  createConfirmation,
  requestTap,
  registerKey,
  isHumanKeySupported,
} from '../../src/index.js';

const RP_ID = 'localhost';
const RP_NAME = 'HumanKey Example';

let registeredCredentialId: string | null = null;
let registeredTransports: string[] = [];

function setStatus(id: string, text: string, type: 'success' | 'error' | 'info') {
  const el = document.getElementById(id)!;
  el.className = `status ${type}`;
  el.textContent = text;
}

async function fetchChallenge(): Promise<{ challengeId: string; challenge: string }> {
  const res = await fetch('/api/challenge', { method: 'POST' });
  return res.json();
}

window.registerKey = async function () {
  if (!isHumanKeySupported()) {
    setStatus('registerStatus', 'WebAuthn not supported in this browser', 'error');
    return;
  }

  try {
    const { challengeId, challenge } = await fetchChallenge();

    const result = await registerKey({
      challenge,
      rpID: RP_ID,
      rpName: RP_NAME,
      userName: 'demo-user',
      userVerification: 'discouraged',
    });

    // Send the raw registration response to the server for verification
    const verifyRes = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response: result.response,
        challengeId,
      }),
    });

    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) {
      setStatus('registerStatus', `Registration failed: ${verifyData.error}`, 'error');
      return;
    }

    registeredCredentialId = verifyData.credentialId;
    registeredTransports = result.transports ?? [];
    setStatus('registerStatus', 'Key registered and verified!', 'success');
    (document.getElementById('registerBtn') as HTMLButtonElement).disabled = true;
  } catch (e) {
    setStatus('registerStatus', `Registration failed: ${(e as Error).message}`, 'error');
  }
};

// Store pending state between confirmation and tap steps
let pendingAction: { action: string; data: Record<string, unknown> } | null = null;
let pendingConfirmation: Awaited<ReturnType<typeof createConfirmation>> | null = null;
let pendingChallengeId: string | null = null;
let pendingChallenge: string | null = null;

window.startConfirmation = async function () {
  if (!registeredCredentialId) {
    setStatus('sendStatus', 'Register a key first!', 'error');
    return;
  }

  const action = {
    action: 'send-message',
    data: {
      to: (document.getElementById('msgTo') as HTMLInputElement).value,
      body: (document.getElementById('msgBody') as HTMLTextAreaElement).value,
    },
  };

  // Use the humankey SDK to derive the confirmation code
  const confirmation = await createConfirmation(action);

  // Get a challenge for the upcoming tap
  const { challengeId, challenge } = await fetchChallenge();

  pendingAction = action;
  pendingConfirmation = confirmation;
  pendingChallengeId = challengeId;
  pendingChallenge = challenge;

  document.getElementById('codeDisplay')!.textContent = confirmation.code;
  document.getElementById('confirmSection')!.style.display = 'block';
  (document.getElementById('codeInput') as HTMLInputElement).value = '';
  (document.getElementById('codeInput') as HTMLInputElement).focus();
};

window.tapToSend = async function () {
  if (!pendingAction || !pendingConfirmation || !pendingChallenge || !pendingChallengeId) {
    setStatus('sendStatus', 'Start confirmation first', 'error');
    return;
  }

  const userInput = (document.getElementById('codeInput') as HTMLInputElement).value;

  try {
    setStatus('sendStatus', 'Tap your YubiKey now...', 'info');

    // Use the humankey SDK — this validates the confirmation code,
    // binds the action + confirmation into the WebAuthn challenge,
    // and prompts the hardware key tap
    const proof = await requestTap({
      challenge: pendingChallenge,
      action: pendingAction,
      confirmation: pendingConfirmation,
      userInput,
      allowCredentials: [{ id: registeredCredentialId! }],
      rpID: RP_ID,
      userVerification: 'discouraged',
    });

    // Send the proof to the server for verification
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof,
        challengeId: pendingChallengeId,
        action: pendingAction,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setStatus('sendStatus', `Verification failed: ${data.error}`, 'error');
      return;
    }

    setStatus(
      'sendStatus',
      `Message sent! verified=${data.verified}, confirmation=${data.confirmationValid}`,
      'success',
    );
    document.getElementById('confirmSection')!.style.display = 'none';
  } catch (e) {
    setStatus('sendStatus', `Failed: ${(e as Error).message}`, 'error');
  } finally {
    pendingAction = null;
    pendingConfirmation = null;
    pendingChallengeId = null;
    pendingChallenge = null;
  }
};

// Type declarations for window functions
declare global {
  interface Window {
    registerKey: () => Promise<void>;
    startConfirmation: () => Promise<void>;
    tapToSend: () => Promise<void>;
  }
}
