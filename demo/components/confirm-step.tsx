'use client';

import { useState } from 'react';

interface ConfirmStepProps {
  recipient: string;
  amount: number;
  confirmationCode: string | null;
  status: string;
  error: { message: string; code?: string } | null;
  onConfirm: (code: string) => Promise<void>;
}

export function ConfirmStep({
  recipient,
  amount,
  confirmationCode,
  status,
  error,
  onConfirm,
}: ConfirmStepProps) {
  const [input, setInput] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    await onConfirm(input.trim());
  }

  const isTapping = status === 'tapping';

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Confirm Transfer</h2>
        <p className="text-gray-400 text-sm">
          Verify this is really you by typing the code and tapping your key.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">To</span>
          <span className="text-gray-100">{recipient}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Amount</span>
          <span className="text-gray-100 font-medium">${amount.toFixed(2)}</span>
        </div>
      </div>

      {confirmationCode && (
        <div className="text-center space-y-1">
          <p className="text-gray-400 text-xs uppercase tracking-wide">Type this code</p>
          <p className="font-mono text-4xl tracking-widest font-bold">{confirmationCode}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder="Enter code"
          maxLength={4}
          disabled={isTapping}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-center font-mono text-2xl tracking-widest text-gray-100 placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors disabled:opacity-50"
          autoFocus
        />

        <button
          type="submit"
          disabled={isTapping || input.length < 4}
          className="w-full bg-white text-gray-950 font-medium py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTapping ? 'Tap your key now...' : 'Confirm & Tap Key'}
        </button>
      </form>

      {error && (
        <p className="text-red-400 text-sm text-center">{error.message}</p>
      )}
    </div>
  );
}
