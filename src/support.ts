/**
 * Check if WebAuthn is supported in this browser.
 * Returns true if the browser supports the credential management API
 * needed for hardware key authentication.
 */
export function isHumanKeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}
