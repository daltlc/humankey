import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HumanKey Demo',
  description: 'Per-action hardware key verification — send money with a tap',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen flex items-center justify-center antialiased">
        {children}
      </body>
    </html>
  );
}
