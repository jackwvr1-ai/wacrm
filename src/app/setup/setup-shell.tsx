'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { AuthProvider, useAuth } from '@/hooks/use-auth';

// /setup sits outside the (dashboard) route group (see layout.tsx), so it
// doesn't inherit AuthProvider from DashboardShell — it needs its own,
// plus its own login guard. Mirrors dashboard-shell.tsx's pattern.
function SetupShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return <div className="min-h-screen bg-background">{children}</div>;
}

export function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SetupShellInner>{children}</SetupShellInner>
    </AuthProvider>
  );
}
