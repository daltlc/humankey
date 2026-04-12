'use client';

interface RegisterStepProps {
  onRegister: () => Promise<void>;
  onReset: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  hasKeys: boolean;
}

export function RegisterStep({ onRegister, onReset, isLoading, error, hasKeys }: RegisterStepProps) {
  return (
    <div className="text-center space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Register Your Key</h2>
        <p className="text-gray-400 text-sm">
          Plug in your hardware key (YubiKey, etc.) or use your device&apos;s built-in authenticator.
        </p>
      </div>

      <button
        onClick={onRegister}
        disabled={isLoading}
        className="w-full bg-white text-gray-950 font-medium py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Waiting for key...' : 'Register Hardware Key'}
      </button>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {hasKeys && (
        <button
          onClick={onReset}
          disabled={isLoading}
          className="text-gray-500 text-xs hover:text-gray-300 transition-colors disabled:opacity-50"
        >
          Reset registered keys
        </button>
      )}
    </div>
  );
}
