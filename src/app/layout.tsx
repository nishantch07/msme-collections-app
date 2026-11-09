import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "MSME Field Collections | AI Prioritised Recovery",
  description: "Mobile-first MSME Collections App with AI Prioritisation, Explainable Scoring, RBI 08:00-19:00 IST Time Guard, and 2-Layer Guardrails by Nishant Chhetri.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-100 text-slate-900 selection:bg-blue-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
