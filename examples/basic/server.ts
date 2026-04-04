/**
 * Minimal Express example demonstrating the humankey flow.
 *
 * Run:
 *   npm start        (from examples/basic/)
 *
 * Then open http://localhost:3000 in a browser with a YubiKey plugged in.
 * Note: WebAuthn requires HTTPS or localhost.
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHumanKeyRouter } from '../../src/express.js';
import type { TapCredential } from '../../src/types.js';

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory credential store (use a database in production)
const credentials = new Map<string, TapCredential>();

app.use('/api', createHumanKeyRouter({
  rpID: 'localhost',
  rpName: 'HumanKey Example',
  origin: 'http://localhost:3000',
  requireUserVerification: false, // localhost doesn't support UV
  getCredential: async (id) => credentials.get(id) ?? null,
  onRegister: async (credential) => {
    credentials.set(credential.id, credential);
  },
}));

// Extra route: list registered credentials for the demo UI
app.get('/api/credentials', (_req, res) => {
  const creds = Array.from(credentials.values()).map((c) => ({
    id: c.id,
    transports: c.transports,
  }));
  res.json({ credentials: creds });
});

app.listen(3000, () => {
  console.log('HumanKey example running at http://localhost:3000');
});
