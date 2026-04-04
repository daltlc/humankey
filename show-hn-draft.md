# Show HN: HumanKey – Per-action hardware key verification for sensitive operations

MFA proves who logged in. It doesn't prove who approved the wire transfer 45 minutes later.

HumanKey is a TypeScript SDK that binds hardware key (YubiKey/FIDO2) taps to individual actions, not just login sessions. For each sensitive operation, the user sees what they're approving, types a 4-char confirmation code derived from the action, and taps their key. The server verifies the signed proof matches the specific action that was displayed.

The flow:

1. Your app describes the action: `{ action: "place-order", data: { symbol: "AAPL", quantity: 500, side: "buy" } }`
2. Server generates a one-time challenge
3. Client derives a 4-char confirmation code from the action hash and shows it to the user
4. User types the code and taps their hardware key
5. Server verifies the signature, the action hash, and the confirmation — all bound together cryptographically

```typescript
// Browser
import { createConfirmation, requestTap } from 'humankey';

const action = { action: 'place-order', data: { symbol: 'AAPL', quantity: 500 } };
const confirmation = await createConfirmation(action);
// Show user: "Approve place-order. Type ABCD to confirm."

const proof = await requestTap({
  challenge,          // from your server
  rpId: 'example.com',
  credentials,        // user's registered keys
  action,
  confirmationCode: userInput,
});
// Send proof to server for verification
```

```typescript
// Server
import { verifyTapProof } from 'humankey/verify';

const result = await verifyTapProof({
  proof,
  credential: storedCredential,
  expectedChallenge: challenge,
  expectedAction: action,
  expectedOrigin: 'https://example.com',
  rpId: 'example.com',
});
// result.verified && result.confirmationValid && result.userVerified
```

Three entry points: `humankey` (browser), `humankey/verify` (server, framework-agnostic), `humankey/express` (drop-in Express router with challenge management).

Built on top of @simplewebauthn (which handles the actual WebAuthn ceremony), HumanKey adds the action-binding and confirmation layers on top.

npm: https://www.npmjs.com/package/humankey

GitHub: https://github.com/[your-username]/humankey

---

# Prepared Responses

## "Why not just use WebAuthn directly?"

Standard WebAuthn answers one question: "Is this the person who registered this credential?" It proves identity at a point in time. It doesn't prove intent about a specific action.

When you call `navigator.credentials.get()`, the challenge is an opaque blob — the user has no idea what they're signing, and the server has no way to bind the signature to a particular operation. The user sees "verify your identity" and taps their key. That same ceremony looks identical whether you're changing a password or approving a $5M transfer.

HumanKey adds three things on top of the WebAuthn assertion:

1. **Action binding** — The challenge is derived from SHA-256(serverChallenge || actionHash || confirmationHash). The server re-derives these hashes during verification, so a signature for "buy 100 AAPL" can't be replayed as approval for "sell 500 TSLA." If the client tampers with the action, verification fails.

2. **Human-readable confirmation** — A 4-char code is derived from the action hash and shown to the user before they tap. This forces a cognitive step: the user has to read what they're approving and actively type a code. It's the difference between "tap to continue" and "you are approving a buy order for 500 shares of AAPL — type XKRM to confirm, then tap your key."

3. **Server-side intent verification** — `verifyTapProof()` doesn't just check the WebAuthn signature. It independently verifies that the action hash matches, the confirmation code was correct, the counter increased (no replay), and UV was performed. You get a structured `{ verified, confirmationValid, userVerified, newCounter }` result instead of a boolean.

You could build all of this yourself with @simplewebauthn — HumanKey is essentially the opinionated glue that makes the pattern a few function calls instead of a few hundred lines of hash derivation, challenge construction, and verification logic.

## "Is this production-ready? It's v0.2.0."

Honest answer: it's early but not fragile.

The core cryptography is not custom — it's standard WebAuthn/FIDO2 via @simplewebauthn/server (which is mature and well-tested). HumanKey's own code is the action-binding layer on top: hash derivation, confirmation code generation, challenge construction, and the verification orchestration. That layer has integration tests running against a software FIDO2 authenticator (not mocked).

What's solid:
- The security model is well-defined with documented limitations (the 4-char confirmation code has ~20.68 bits of entropy — rate-limiting on verification attempts is required and documented)
- Server verification is framework-agnostic — works anywhere Node/Deno/Bun runs
- TypeScript strict mode, dual ESM/CJS builds
- The Express adapter includes challenge TTL and a pluggable challenge store interface (swap MemoryChallengeStore for Redis/DB in production)

What's still maturing:
- The API surface could still change before 1.0 (though we're trying to keep it stable)
- The Express adapter is convenient but simple — production deployments will likely want custom middleware for rate-limiting, logging, and session binding
- Documentation covers the happy path well; edge case guides are still being written
- No AAGUID allowlist database ships with the package (you bring your own if you want to restrict authenticator models)

If you're evaluating it: the verification logic is about 200 lines total — read it, it's auditable.
