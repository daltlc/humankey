import { createHumanKeyHandlers, MemoryChallengeStore } from 'humankey/nextjs';
import type { TapCredential } from 'humankey/verify';

// Persist in-memory state across Next.js HMR re-evaluations
declare global {
  // eslint-disable-next-line no-var
  var __humankeyChallengeStore: MemoryChallengeStore | undefined;
  // eslint-disable-next-line no-var
  var __humankeyCredentials: Map<string, TapCredential> | undefined;
}

const challengeStore = global.__humankeyChallengeStore ??= new MemoryChallengeStore();
const credentials = global.__humankeyCredentials ??= new Map<string, TapCredential>();

const hk = createHumanKeyHandlers({
  rpID: 'localhost',
  rpName: 'HumanKey Demo',
  origin: 'http://localhost:3000',
  requireUserVerification: false,
  challengeStore,
  getCredential: async (id) => credentials.get(id) ?? null,
  onRegister: async (cred) => {
    credentials.set(cred.id, cred);
  },
  onVerify: async (result, _action) => {
    // Update the stored counter to prevent replay
    const cred = [...credentials.values()].find(
      (c) => result.newCounter > c.counter,
    );
    if (cred) {
      cred.counter = result.newCounter;
    }
  },
});

function getCredentialList() {
  return [...credentials.values()].map((c) => ({
    id: c.id,
    transports: c.transports,
  }));
}

function clearCredentials() {
  credentials.clear();
}

export { hk, getCredentialList, clearCredentials };
