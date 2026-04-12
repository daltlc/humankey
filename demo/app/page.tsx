'use client';

import { useState, useCallback, useEffect } from 'react';
import { useHumanKey } from 'humankey/react';
import { RegisterStep } from '@/components/register-step';
import { SendForm } from '@/components/send-form';
import { ConfirmStep } from '@/components/confirm-step';

type Step = 'register' | 'form' | 'confirm' | 'done';

interface Transfer {
  recipient: string;
  amount: number;
}

interface Credential {
  id: string;
  transports?: string[];
}

export default function Home() {
  const [step, setStep] = useState<Step>('register');
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [hasKeys, setHasKeys] = useState(false);

  const hk = useHumanKey({ rpID: 'localhost' });

  const fetchCredentials = useCallback(async (): Promise<Credential[]> => {
    const res = await fetch('/api/credentials');
    const data = await res.json();
    return data.credentials ?? [];
  }, []);

  const handleRegister = useCallback(async () => {
    setRegisterLoading(true);
    setRegisterError(null);
    try {
      await hk.register('demo-user');
    } catch (err) {
      // Registration may have succeeded server-side even if the client threw
      // (e.g. on first PIN setup). Check if credentials exist before failing.
      const existing = await fetchCredentials();
      if (existing.length > 0) {
        setCredentials(existing);
        setHasKeys(true);
        setStep('form');
        setRegisterLoading(false);
        return;
      }
      setRegisterError(err instanceof Error ? err.message : 'Registration failed');
      setRegisterLoading(false);
      return;
    }
    const creds = await fetchCredentials();
    setCredentials(creds);
    setHasKeys(creds.length > 0);
    setStep('form');
    setRegisterLoading(false);
  }, [hk, fetchCredentials]);

  // Check if keys already exist on mount (e.g. after page refresh while server still running)
  useEffect(() => {
    fetchCredentials().then((creds) => setHasKeys(creds.length > 0));
  }, [fetchCredentials]);

  const handleResetKeys = useCallback(async () => {
    await fetch('/api/credentials', { method: 'DELETE' });
    setCredentials([]);
    setHasKeys(false);
    setRegisterError(null);
  }, []);

  const handleSend = useCallback(async (recipient: string, amount: number) => {
    setTransfer({ recipient, amount });
    await hk.startAction(
      { action: 'send-money', data: { recipient, amount } },
      credentials,
    );
    setStep('confirm');
  }, [hk, credentials]);

  const handleConfirm = useCallback(async (code: string) => {
    await hk.confirmCode(code);
    setStep('done');
  }, [hk]);

  const handleReset = useCallback(() => {
    hk.reset();
    setTransfer(null);
    setStep('form');
  }, [hk]);

  return (
    <main className="w-full max-w-sm mx-auto p-6">
      <div className="mb-8 text-center">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-gray-400">human</span>key
        </h1>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
        {step === 'register' && (
          <RegisterStep
            onRegister={handleRegister}
            onReset={handleResetKeys}
            isLoading={registerLoading}
            error={registerError}
            hasKeys={hasKeys}
          />
        )}

        {step === 'form' && (
          <SendForm onSubmit={handleSend} />
        )}

        {step === 'confirm' && transfer && (
          <ConfirmStep
            recipient={transfer.recipient}
            amount={transfer.amount}
            confirmationCode={hk.confirmationCode}
            status={hk.status}
            error={hk.error}
            onConfirm={handleConfirm}
          />
        )}

        {step === 'done' && transfer && (
          <div className="text-center space-y-6">
            <div className="space-y-2">
              <div className="text-4xl">&#x2713;</div>
              <h2 className="text-2xl font-semibold">Transfer Approved</h2>
              <p className="text-gray-400 text-sm">
                ${transfer.amount.toFixed(2)} to {transfer.recipient}
              </p>
            </div>
            <button
              onClick={handleReset}
              className="w-full bg-gray-800 text-gray-100 font-medium py-3 px-6 rounded-lg hover:bg-gray-700 transition-colors"
            >
              Send Another
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
