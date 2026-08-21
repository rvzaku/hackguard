import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HackGuard',
  description:
    'Decision brain above Stripe built-in retries: triage, timed retries, compliance guardrails.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
