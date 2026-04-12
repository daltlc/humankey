'use client';

import { useState } from 'react';

interface SendFormProps {
  onSubmit: (recipient: string, amount: number) => void;
}

export function SendForm({ onSubmit }: SendFormProps) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!recipient.trim() || isNaN(parsed) || parsed <= 0) return;
    onSubmit(recipient.trim(), parsed);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Send Money</h2>
        <p className="text-gray-400 text-sm">
          Enter the details below. You&apos;ll confirm with your hardware key before sending.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="recipient" className="block text-sm font-medium text-gray-300 mb-1">
            Recipient
          </label>
          <input
            id="recipient"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="alice@example.com"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            required
          />
        </div>

        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-300 mb-1">
            Amount (USD)
          </label>
          <input
            id="amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            required
          />
        </div>
      </div>

      <button
        type="submit"
        className="w-full bg-white text-gray-950 font-medium py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors"
      >
        Continue
      </button>
    </form>
  );
}
