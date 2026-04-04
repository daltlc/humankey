# humankey

Per-action hardware key (YubiKey/FIDO2) verification SDK with built-in confirmation step.

Proves a human physically tapped a security key **and** confirmed they understood what they were approving — for every action, not just login.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Build**: tsup (dual ESM/CJS output)
- **Test**: vitest
- **Core dependency**: [@simplewebauthn/browser](https://simplewebauthn.dev/) (peer) + [@simplewebauthn/server](https://simplewebauthn.dev/) (verify)
- **Target runtimes**: Browser (client SDK), Node/Deno/Bun/Edge (verify utility)

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
│   ├── express.ts            # Express framework adapter (humankey/express)
│   ├── hash.ts               # SHA-256 canonical JSON hashing (isomorphic)
│   ├── types.ts              # All type definitions
│   └── errors.ts             # Typed error classes
├── tests/                    # vitest test suite
│   ├── helpers/
│   │   └── soft-authenticator.ts  # Software FIDO2 authenticator for integration tests
│   └── integration.test.ts   # End-to-end tests against real @simplewebauthn/server
└── examples/basic/           # Working Express + HTML example
```

**Three entry points:**
- `humankey` — browser SDK (confirm + tap + register)
- `humankey/verify` — server-side verification, registration, and challenge generation (any JS runtime)
- `humankey/express` — Express router with built-in challenge lifecycle, registration, and verification

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

For the Express adapter:

```bash
npm install humankey express
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
| `humankey/express` | Server (Express) | `createHumanKeyRouter`, `MemoryChallengeStore`, `ChallengeStore`, `HumanKeyExpressConfig` |

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
