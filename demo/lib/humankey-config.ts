import { createHumanKeyHandlers, MemoryChallengeStore } from 'humankey/nextjs';
import type { TapCredential } from 'humankey/verify';

const credentials = new Map<string, TapCredential>();

const hk = createHumanKeyHandlers({
  rpID: 'localhost',
  rpName: 'HumanKey Demo',
  origin: 'http://localhost:3000',
  requireUserVerification: false,
  challengeStore: new MemoryChallengeStore(),
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

export { hk, getCredentialList };
