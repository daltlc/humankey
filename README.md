# humankey

Per-action hardware key verification for sensitive operations. Proves a human physically approved each action — not just that they logged in.

**[Live Demo](https://humankey-demo.vercel.app/)** | **[npm](https://www.npmjs.com/package/humankey)**

## The Problem

WebAuthn is great for login — but login only proves who you are, not what you approved. A compromised session can silently initiate transfers, change settings, or delete data without the user ever touching their key again.

There's no standard way to require a hardware key tap **per action**, and no way to prove the user actually read what they were approving before they tapped.

## The Solution

humankey is a TypeScript SDK that adds per-action hardware key verification with a built-in confirmation step. For every sensitive action, the user:

1. **Reads** the action details and a confirmation code derived from the action itself
2. **Types** the code back (proving they read and understood)
3. **Taps** their hardware key (proving physical presence)

The server independently re-derives everything — a compromised client can't fake approval for a different action.

Drop-in adapters for Express, Next.js, Hono, and Fastify. A React hook for the client. Works with any FIDO2 key (YubiKey, Titan, platform authenticators).

## How It Works

```
1. Your server:     createChallenge() → send to client
2. humankey:        createConfirmation(action) → show code to user, user types it back
3. humankey:        requestTap(challenge, action, confirmation) → user taps YubiKey → TapProof
4. Your client:     send TapProof to your server
5. humankey/verify: verifyTapProof(proof, ...) → { verified, confirmationValid }
```

The confirmation code is derived from the action hash — a compromised client can't predict the code for a different action. The server re-derives everything independently.

## Installation

```bash
npm install humankey @simplewebauthn/browser
```

`@simplewebauthn/browser` is a peer dependency (only needed in the browser).

For framework adapters, install the framework alongside humankey:

```bash
npm install humankey express        # Express
npm install humankey hono           # Hono
npm install humankey fastify        # Fastify
```

For the React hook:

```bash
npm install humankey @simplewebauthn/browser react
```

## Usage

### Express Adapter (recommended)

The fastest way to add humankey to an Express app. Handles challenge lifecycle, registration, and verification automatically.

```ts
import express from 'express';
import { createHumanKeyRouter } from 'humankey/express';
import type { TapCredential } from 'humankey/verify';

const app = express();
app.use(express.json());

const credentials = new Map<string, TapCredential>();

app.use('/api', createHumanKeyRouter({
  rpID: 'example.com',
  rpName: 'My App',
  origin: 'https://example.com',
  getCredential: async (id) => credentials.get(id) ?? null,
  onRegister: async (credential) => {
    credentials.set(credential.id, credential);
  },
  onVerify: async (result, action) => {
    console.log('Verified action:', action, result);
  },
}));

app.listen(3000);
```

This creates three routes:
- `POST /api/challenge` — generates and stores a challenge, returns `{ challengeId, challenge }`
- `POST /api/register` — verifies registration, calls `onRegister`, returns `{ ok, credentialId }`
- `POST /api/verify` — verifies tap proof, calls `onVerify`, returns `{ verified, confirmationValid, newCounter }`

#### Configuration

```ts
createHumanKeyRouter({
  rpID: 'example.com',               // Required: relying party ID
  rpName: 'My App',                  // Required: relying party name
  origin: 'https://example.com',     // Required: expected origin(s)
  getCredential: async (id) => ...,  // Required: credential lookup
  onRegister: async (cred) => ...,   // Required: store new credentials
  onVerify: async (result, action) => ..., // Optional: post-verification hook
  challengeTTL: 60_000,              // Optional: challenge TTL in ms (default: 60s)
  challengeStore: customStore,       // Optional: custom ChallengeStore (default: in-memory)
  requireUserVerification: true,     // Optional: require PIN/biometric (default: true)
  allowedAAGUIDs: ['...'],           // Optional: restrict authenticator models
});
```

#### Custom Challenge Store

The default `MemoryChallengeStore` works for single-process deployments. For multi-server setups, implement the `ChallengeStore` interface:

```ts
import type { ChallengeStore } from 'humankey/express';

class RedisChallengeStore implements ChallengeStore {
  constructor(private redis: RedisClient) {}

  async set(id: string, challenge: string, ttlMs: number): Promise<void> {
    await this.redis.set(`hk:${id}`, challenge, 'PX', ttlMs);
  }

  async get(id: string): Promise<string | null> {
    const challenge = await this.redis.get(`hk:${id}`);
    if (challenge) await this.redis.del(`hk:${id}`); // single-use
    return challenge;
  }
}
```

### Next.js Adapter

For Next.js App Router. Each route handler is a separate file:

```ts
// lib/humankey-config.ts
import { createHumanKeyHandlers, MemoryChallengeStore } from 'humankey/nextjs';
import type { TapCredential } from 'humankey/verify';

// Persist in-memory state across Next.js HMR re-evaluations.
// Without this, dev mode re-creates the store between requests,
// causing "Challenge not found or expired" errors.
declare global {
  // eslint-disable-next-line no-var
  var __humankeyChallengeStore: MemoryChallengeStore | undefined;
  // eslint-disable-next-line no-var
  var __humankeyCredentials: Map<string, TapCredential> | undefined;
}

const challengeStore = global.__humankeyChallengeStore ??= new MemoryChallengeStore();
const credentials = global.__humankeyCredentials ??= new Map<string, TapCredential>();

export const hk = createHumanKeyHandlers({
  rpID: 'example.com',
  rpName: 'My App',
  origin: 'https://example.com',
  challengeStore,
  getCredential: async (id) => credentials.get(id) ?? null,
  onRegister: async (credential) => {
    credentials.set(credential.id, credential);
  },
});
```

```ts
// app/api/humankey/challenge/route.ts
import { hk } from '@/lib/humankey-config';
export const POST = hk.challenge;
```

```ts
// app/api/humankey/register/route.ts
export const POST = hk.register;

// app/api/humankey/verify/route.ts
export const POST = hk.verify;
```

Uses the Web `Request`/`Response` API — no Next.js-specific types required.

### Hono Adapter

```ts
import { Hono } from 'hono';
import { createHumanKeyApp } from 'humankey/hono';
import type { TapCredential } from 'humankey/verify';

const app = new Hono();
const credentials = new Map<string, TapCredential>();

app.route('/api', createHumanKeyApp({
  rpID: 'example.com',
  rpName: 'My App',
  origin: 'https://example.com',
  getCredential: async (id) => credentials.get(id) ?? null,
  onRegister: async (credential) => {
    credentials.set(credential.id, credential);
  },
}));

export default app;
```

### Fastify Adapter

```ts
import Fastify from 'fastify';
import { humanKeyPlugin } from 'humankey/fastify';
import type { TapCredential } from 'humankey/verify';

const app = Fastify();
const credentials = new Map<string, TapCredential>();

app.register(humanKeyPlugin, {
  prefix: '/api',
  rpID: 'example.com',
  rpName: 'My App',
  origin: 'https://example.com',
  getCredential: async (id) => credentials.get(id) ?? null,
  onRegister: async (credential) => {
    credentials.set(credential.id, credential);
  },
});

app.listen({ port: 3000 });
```

### React Hook

The `useHumanKey` hook manages the full client-side flow: fetch challenge, show confirmation code, trigger hardware key tap, and verify.

```tsx
import { useHumanKey } from 'humankey/react';

function TransferButton({ credentialId }: { credentialId: string }) {
  const {
    status,
    confirmationCode,
    error,
    startAction,
    confirmCode,
    reset,
  } = useHumanKey({ rpID: 'example.com', apiBase: '/api' });

  const handleTransfer = async () => {
    // Step 1: Start the action — fetches challenge, generates confirmation code
    await startAction(
      { action: 'transfer', data: { to: 'bob', amount: 100 } },
      [{ id: credentialId }],
    );
    // status is now 'confirming', confirmationCode is e.g. 'A7X3'
  };

  const handleConfirm = async (userInput: string) => {
    // Step 2: User typed the code — triggers YubiKey tap and server verification
    const proof = await confirmCode(userInput);
    // status is now 'verified', proof contains the signed assertion
  };

  return (
    <div>
      {status === 'idle' && <button onClick={handleTransfer}>Send $100</button>}
      {status === 'confirming' && (
        <div>
          <p>Type this code: <strong>{confirmationCode}</strong></p>
          <input onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm(e.currentTarget.value);
          }} />
        </div>
      )}
      {status === 'tapping' && <p>Tap your YubiKey...</p>}
      {status === 'verified' && <p>Transfer approved!</p>}
      {status === 'error' && <p>Error: {error?.message} <button onClick={reset}>Retry</button></p>}
    </div>
  );
}
```

The hook also exposes a `register` function for one-time key registration:

```tsx
const { register } = useHumanKey({ rpID: 'example.com' });
const result = await register('alice');
// result.credentialId — store this for future use
```

### Server (manual — challenge + registration + verify)

```ts
import {
  verifyTapProof,
  verifyRegistration,
  createChallenge,
} from 'humankey/verify';

// Generate a challenge (base64url, 256-bit)
const challenge = createChallenge();

// After client registers a key, verify the registration
const { credential } = await verifyRegistration({
  response: registrationResponseFromClient,
  expectedChallenge: challenge,
  expectedOrigin: 'https://example.com',
  expectedRPID: 'example.com',
});
// → store credential server-side

// After client sends a TapProof, verify it
const result = await verifyTapProof({
  proof,
  credential,                        // stored TapCredential
  expectedChallenge,                 // the challenge you generated
  expectedAction: action,            // your server's copy of the action
  expectedOrigin: 'https://example.com',
  expectedRPID: 'example.com',
  requireUserVerification: true,
  requireConfirmation: true,         // default: throws if code is wrong
});
// result.verified            → signature is valid
// result.confirmationValid   → user typed the correct code
// result.userVerified        → biometric/PIN was used
// result.newCounter          → update stored counter
```

### Browser (register + confirm + tap)

```ts
import { createConfirmation, requestTap, registerKey, isHumanKeySupported } from 'humankey';

// Check support
if (!isHumanKeySupported()) {
  throw new Error('WebAuthn not supported in this browser');
}

// One-time: register a hardware key
const registration = await registerKey({
  challenge,           // from your server
  rpID: 'example.com',
  rpName: 'My App',
  userName: 'alice',
});
// → send registration.response to your server for verifyRegistration()

// Per-action: confirm + tap
const action = { action: 'send-message', data: { to: 'bob', body: 'hello' } };
const confirmation = createConfirmation(action);
// confirmation.code → "A7X3"
// Show in your UI: "You're sending a message to bob. Type A7X3 to confirm."

// After user types the code:
const proof = await requestTap({
  challenge,           // from your server (unique per action)
  action,
  confirmation,
  userInput: 'A7X3',  // what the user typed
  allowCredentials: [{ id: registration.credentialId }],
  rpID: 'example.com',
});
// → send proof to your server for verifyTapProof()
```

## Attestation Allowlist (AAGUIDs)

For high-security deployments, restrict which authenticator models are accepted during registration. Each FIDO2 authenticator has an AAGUID — a UUID identifying its make and model.

```ts
// Only allow YubiKey 5 series (example AAGUIDs)
const result = await verifyRegistration({
  response: registrationResponse,
  expectedChallenge: challenge,
  expectedOrigin: 'https://example.com',
  expectedRPID: 'example.com',
  allowedAAGUIDs: [
    'cb69481e-8ff7-4039-93ec-0a2729a154a8', // YubiKey 5 NFC
    'ee882879-721c-4913-9775-3dfcce97072a', // YubiKey 5Ci
  ],
});
```

If the authenticator's AAGUID is not in the list, registration throws `AAGUID_NOT_ALLOWED`. When `allowedAAGUIDs` is omitted or empty, any authenticator is accepted.

The AAGUID is also stored on the `TapCredential` for auditing:

```ts
console.log(credential.aaguid); // "cb69481e-8ff7-4039-93ec-0a2729a154a8"
```

Find AAGUIDs for specific hardware keys in the [FIDO Alliance Metadata Service](https://fidoalliance.org/metadata/).

## Rate-Limiting Guide

The 4-character confirmation code has ~20.68 bits of entropy (~1.7 million combinations). Without rate limiting, an attacker with a stolen key could brute-force the code.

**You must rate-limit the verification endpoint.** Example with `express-rate-limit`:

```ts
import rateLimit from 'express-rate-limit';

const verifyLimiter = rateLimit({
  windowMs: 60_000,   // 1 minute
  max: 5,             // 5 attempts per window
  keyGenerator: (req) => req.ip ?? 'unknown',
  message: { error: 'Too many verification attempts' },
});

app.use('/api/verify', verifyLimiter);
```

For production, consider:
- Per-credential rate limiting (not just per-IP)
- Exponential backoff after consecutive failures
- Alerting on repeated failures (possible stolen key)

## Security Model

### What humankey proves

- A human with physical access to a registered hardware key approved the action
- The human confirmed they understood the action (typed the correct confirmation code)
- The approval is cryptographically bound to the specific action payload
- The approval is one-time use (challenge nonce prevents replay)
- The hardware key is genuine (attestation verification by default)

### Known limitations and mitigations

| Limitation | Status | Future Solution |
|---|---|---|
| **Blind tap** — key has no display | **Mitigated** — confirmation code proves the user read the action details | `txAuthSimple` FIDO2 extension when display-equipped keys become mainstream |
| **Compromised client (XSS)** — could show wrong action | **Mitigated** — server re-derives action hash + confirmation code independently | CSP hardening guide |
| **Software authenticator spoofing** | **Mitigated** — `allowedAAGUIDs` restricts to known hardware models | Attestation certificate chain validation |
| **Safari UV flag in clamshell mode** | **Mitigated** — independent UV flag check in `verifyTapProof()` | N/A, already handled |
| **Single-key single-factor** | Configurable — `userVerification: 'required'` adds PIN/biometric | Multi-key quorum (2-of-3) in future version |
| **Confirmation code entropy** | ~20.68 bits (36^4) — rate-limit attempts | Longer codes or richer character sets in future version |

### Security recommendations

1. Generate challenges server-side with `createChallenge()` from `humankey/verify`
2. Enforce short TTLs on challenges (60s or less)
3. Delete challenges after single use (prevent replay)
4. **Rate-limit confirmation code attempts** — the 4-character code has ~20.68 bits of entropy (~1.7M combinations)
5. Pass `expectedAction` from your server's copy — never trust client-provided action data
6. Store credential public keys securely
7. Monitor signature counters for anomalies (counter going backwards = cloned key)
8. Use `allowedAAGUIDs` to restrict authenticator models in high-security environments

## API Reference

### Entry Points

| Import | Environment | Contents |
|---|---|---|
| `humankey` | Browser | `createConfirmation`, `requestTap`, `registerKey`, `isHumanKeySupported`, `hashAction`, `HumanKeyError` |
| `humankey/verify` | Server (any JS runtime) | `verifyTapProof`, `verifyRegistration`, `createChallenge`, `HumanKeyError` |
| `humankey/express` | Server (Express) | `createHumanKeyRouter`, `MemoryChallengeStore`, `ChallengeStore` |
| `humankey/nextjs` | Server (Next.js App Router) | `createHumanKeyHandlers`, `MemoryChallengeStore`, `ChallengeStore` |
| `humankey/hono` | Server (Hono) | `createHumanKeyApp`, `MemoryChallengeStore`, `ChallengeStore` |
| `humankey/fastify` | Server (Fastify) | `humanKeyPlugin`, `MemoryChallengeStore`, `ChallengeStore` |
| `humankey/react` | Browser (React) | `useHumanKey` |

### Error Codes

| Code | Thrown by | Meaning |
|---|---|---|
| `CONFIRMATION_MISMATCH` | `verifyTapProof` | User typed wrong confirmation code |
| `ACTION_HASH_MISMATCH` | `verifyTapProof` | Client signed a different action than expected |
| `VERIFICATION_FAILED` | `verifyTapProof` | WebAuthn signature invalid |
| `COUNTER_REPLAY` | `verifyTapProof` | Counter didn't increase (possible cloned key) |
| `USER_VERIFICATION_MISSING` | `verifyTapProof` | UV required but authenticator didn't verify user |
| `AAGUID_NOT_ALLOWED` | `verifyRegistration` | Authenticator model not in allowlist |
| `REGISTRATION_FAILED` | `verifyRegistration` | WebAuthn registration verification failed |
| `WEBAUTHN_NOT_SUPPORTED` | `registerKey`, `requestTap` | Browser doesn't support WebAuthn |
| `USER_CANCELLED` | `registerKey`, `requestTap` | User cancelled the WebAuthn prompt |

### `verifyTapProof(request)` options

| Option | Default | Description |
|---|---|---|
| `requireUserVerification` | `true` | Throw if the authenticator didn't verify the user (PIN/biometric) |
| `requireConfirmation` | `true` | Throw `CONFIRMATION_MISMATCH` if the user typed the wrong code. Set `false` to check `result.confirmationValid` manually. |

### `verifyRegistration(request)` options

| Option | Default | Description |
|---|---|---|
| `requireUserVerification` | `true` | Throw if UV flag is not set |
| `allowedAAGUIDs` | `undefined` | Array of allowed authenticator AAGUIDs. If set and non-empty, throws `AAGUID_NOT_ALLOWED` for unlisted models. |

## Architecture

```
humankey/
├── src/
│   ├── index.ts              # Browser exports: createConfirmation, requestTap, registerKey, isHumanKeySupported
│   ├── confirm.ts            # Confirmation code generation + validation
│   ├── tap.ts                # WebAuthn assertion with action binding
│   ├── register.ts           # One-time hardware key registration
│   ├── support.ts            # Feature detection
│   ├── verify.ts             # Server-side proof verification (humankey/verify)
│   ├── registration-verify.ts # Server-side registration verification
│   ├── challenge.ts          # Server-side challenge generation
│   ├── adapter-core.ts       # Shared handler logic for all framework adapters
│   ├── express.ts            # Express framework adapter (humankey/express)
│   ├── nextjs.ts             # Next.js App Router adapter (humankey/nextjs)
│   ├── hono.ts               # Hono adapter (humankey/hono)
│   ├── fastify.ts            # Fastify plugin (humankey/fastify)
│   ├── react.ts              # React hook (humankey/react)
│   ├── hash.ts               # SHA-256 canonical JSON hashing (isomorphic)
│   ├── types.ts              # All type definitions
│   └── errors.ts             # Typed error classes
├── tests/                    # vitest test suite
│   ├── helpers/
│   │   └── soft-authenticator.ts  # Software FIDO2 authenticator for integration tests
│   └── integration.test.ts   # End-to-end tests against real @simplewebauthn/server
└── examples/basic/           # Working Express + HTML example
```

**Seven entry points:**
- `humankey` — browser SDK (confirm + tap + register)
- `humankey/verify` — server-side verification, registration, and challenge generation (any JS runtime)
- `humankey/express` — Express router with built-in challenge lifecycle, registration, and verification
- `humankey/nextjs` — Next.js App Router route handlers
- `humankey/hono` — Hono app with humankey routes
- `humankey/fastify` — Fastify plugin
- `humankey/react` — React hook for the confirm → tap flow

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Build**: tsup (dual ESM/CJS output)
- **Test**: vitest
- **Core dependency**: [@simplewebauthn/browser](https://simplewebauthn.dev/) (peer) + [@simplewebauthn/server](https://simplewebauthn.dev/) (verify)
- **Target runtimes**: Browser (client SDK), Node/Deno/Bun/Edge (verify utility)

## Development

```bash
npm install          # install dependencies
npm run build        # build ESM + CJS
npm run test         # run tests
npm run typecheck    # type check
npm run dev          # watch mode
```

### Running the example

```bash
cd examples/basic
npm install
npm start
# → open http://localhost:3000
```

### Running the demo app

```bash
cd demo
npm install
npm run dev
# → open http://localhost:3000
```

A Next.js app that walks through the full humankey flow: register a hardware key → fill in a send-money form → confirm with code + key tap.

**Hardware key PIN behavior:** Your hardware key (YubiKey, etc.) has its own PIN that lives on the physical device. This PIN is **always** required during registration and verification — it's the key's own security layer and is completely independent of humankey. The first time you use a key, the browser will ask you to **set** a PIN. On subsequent uses, it will ask you to **enter** it. The "Clear server credentials" button in the demo only removes the server's record of your key — it cannot clear the PIN from the physical hardware. This is expected behavior.

**Next.js note:** The demo uses `globalThis` to persist in-memory challenge and credential state across Next.js hot module reloads. Without this, the `MemoryChallengeStore` would be re-created between API requests in dev mode, causing "Challenge not found or expired" errors. See `demo/lib/humankey-config.ts` for the pattern. In production, use a persistent store (Redis, database) instead.

## Changelog

### v0.2.0

**New features:**
- **Express adapter** (`humankey/express`) — `createHumanKeyRouter()` provides a complete Express router with challenge lifecycle, registration, and verification. Includes `MemoryChallengeStore` (in-memory, single-use, TTL-based) and a `ChallengeStore` interface for custom backends (Redis, etc.).
- **Attestation allowlist** — `allowedAAGUIDs` option on `verifyRegistration()` restricts accepted authenticator models by AAGUID. `TapCredential` now includes `aaguid` field.
- **Integration tests** — end-to-end tests using a software FIDO2 authenticator against real `@simplewebauthn/server` (no mocks). Covers full registration, tap flow, confirmation mismatch, action tampering, and counter replay.
- **Counter replay detection** — `verifyTapProof()` now correctly returns `COUNTER_REPLAY` error code when the authenticator counter doesn't increase.

**Breaking changes:**
- `TapCredential` now includes a required `aaguid: string` field. Existing stored credentials need this field added (use `'00000000-0000-0000-0000-000000000000'` as a default for credentials registered before this version).

### v0.1.0

- `registerKey()` now returns `RegistrationResult` (with `credentialId`, `response`, `transports`) instead of `{ credential, response }`. Use `verifyRegistration()` server-side to get the full `TapCredential`.
- `verifyTapProof()` now throws `CONFIRMATION_MISMATCH` by default when the confirmation code is wrong. Pass `requireConfirmation: false` for the old behavior.
- Confirmation code derivation uses 16-bit values instead of single bytes, eliminating modulo bias. Codes for the same action will differ from previous versions.
- Error messages no longer leak expected/actual confirmation code values.

## License

MIT
