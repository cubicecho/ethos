import { useQuery } from '@apollo/client';
import type { ReactNode } from 'react';
import { ThemeSelector } from '@/components/domain/settings/theme-selector';
import { MeDocument } from '@/lib/graphql';

/** One card per thing you can change. Sections, not tabs — there are two. */
function Section({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      {title ? (
        <header className="mb-4">
          <h2 className="font-medium text-base">{title}</h2>
          {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export default function SettingsScreen() {
  // `users` is scoped to the caller, so the list is the one row the token
  // names — there is no "me" query because there is no one else to ask about.
  const { data } = useQuery(MeDocument);
  const me = data?.users?.[0];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="border-b pb-4">
        <h1 className="font-semibold text-2xl tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground text-sm">Theme is kept on this device; the account is not.</p>
      </header>

      <Section title="Theme" description="System follows whatever your operating system is set to.">
        <ThemeSelector />
      </Section>

      <Section title="Account" description="Sign in with a link sent to this address.">
        <p className="text-sm">{me?.email ?? '—'}</p>
      </Section>
    </div>
  );
}
