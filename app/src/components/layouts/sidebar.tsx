import { useQuery } from '@apollo/client';
import { Link, usePathname } from 'expo-router';
import { Archive, CalendarCheck, LogOut, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { HabitFormDialog } from '@/components/domain/habit/habit-form-dialog';
import { HabitListItem } from '@/components/domain/habit/habit-list-item';
import { Button } from '@/components/ui/button';
import { LoadFailure } from '@/components/ui/load-failure';
import { Spinner } from '@/components/ui/spinner';
import { clearToken } from '@/lib/auth';
import { HabitsDocument } from '@/lib/graphql';
import { useToday } from '@/lib/use-today';
import { cn } from '@/lib/utils';

function NavLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors',
        active ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground hover:bg-accent/60',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

/** The persistent shell: today, and every habit, always one click away. */
export function Sidebar() {
  const pathname = usePathname();
  const today = useToday();
  const { data, loading, error, refetch } = useQuery(HabitsDocument, { variables: { today } });
  const [creating, setCreating] = useState(false);
  const habits = data?.habits ?? [];
  const nextPosition = habits.reduce((max, habit) => Math.max(max, habit.position), -1) + 1;

  function signOut() {
    clearToken();
    window.location.replace('/login');
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground">
      <div className="px-4 pt-4 pb-3">
        <Link href="/" className="font-semibold text-foreground text-lg tracking-tight no-underline">
          Ethos
        </Link>
      </div>

      {/* The one action the sidebar offers, so it says what it does rather than
          leaving a bare `+` next to the title for the reader to interpret, and
          it wears `primary` — the theme's teal — rather than an outline. Nothing
          else in the sidebar is filled, so the colour is the whole hierarchy:
          spend it on the action and the habit rows stay quiet. Taking it from
          the token rather than a literal is what keeps it legible in both
          themes; `--primary` is darker in light mode and brighter in dark. */}
      <div className="px-3">
        <Button size="sm" className="w-full gap-2 rounded-lg" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New habit
        </Button>
      </div>

      <div className="flex flex-col gap-0.5 px-2 pt-4">
        <NavLink href="/" icon={CalendarCheck} label="Today" active={pathname === '/'} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pt-4 pb-2">
        {/* `border-b` rather than a Separator element: the footer below already
            draws its rule this way, and a divider that is part of the block it
            labels cannot drift away from it. It is inset by the nav's own
            padding so it lines up with the habit rows, not the sidebar edge. */}
        <p className="mb-1 border-b px-2 pb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Habits
        </p>
        {loading && habits.length === 0 ? (
          <div className="px-2 py-2">
            <Spinner />
          </div>
        ) : error && habits.length === 0 ? (
          /* Only when there is nothing to show. A refetch that fails while the
             last good list is still on screen should leave it there — the rail
             is how you get anywhere, and replacing it with an apology would
             strand the reader on whatever page they are already on. */
          <LoadFailure error={error} onRetry={refetch} className="px-2 py-2" />
        ) : habits.length === 0 ? (
          <p className="px-2 py-2 text-muted-foreground text-sm">No habits yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {habits.map((habit) => (
              <HabitListItem
                key={habit.id}
                id={habit.id}
                name={habit.name}
                color={habit.color}
                streak={habit.streak}
                active={pathname === `/habits/${habit.id}`}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-0.5 border-t p-2">
        <NavLink href="/archive" icon={Archive} label="Archive" active={pathname === '/archive'} />
        <NavLink href="/settings" icon={Settings} label="Settings" active={pathname === '/settings'} />
        <button
          type="button"
          onClick={signOut}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground text-sm hover:bg-accent/60 hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>

      <HabitFormDialog open={creating} onOpenChange={setCreating} today={today} nextPosition={nextPosition} />
    </aside>
  );
}
