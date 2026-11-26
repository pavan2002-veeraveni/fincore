import type { Metadata } from 'next';
import '@/styles/globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'FinCore — Simulated Digital Wallet, Ledger & Payment Platform',
  description:
    'Educational fintech simulation featuring double-entry ledger accounting, atomic transfers, webhook verification, reconciliation, and risk analytics.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
