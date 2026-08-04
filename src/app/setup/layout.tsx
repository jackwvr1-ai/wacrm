import type { Metadata } from 'next';
import { SetupShell } from './setup-shell';

// Server layout, mirrors (dashboard)/layout.tsx's noindex metadata.
//
// CRITICAL: /setup lives OUTSIDE the (dashboard) route group on purpose.
// Fase 3.4b will make the dashboard layout redirect here when the
// business isn't configured yet — nesting /setup under that same layout
// would turn that redirect into a loop.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SetupShell>{children}</SetupShell>;
}
