import { useQuery } from '@apollo/client';
import { Link, usePathname } from 'expo-router';
import { useState } from 'react';
import { Archive, CalendarCheck, LogOut } from '@/components/app-icons';
import { HabitFormDialog } from '@/components/domain/habit/habit-form-dialog';
import { EmptyState } from '@/components/page';
import { Sidebar as SidebarFrame, SidebarNavItem, SidebarSection } from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { ColorDot } from '@/components/ui/color-dot';
import { Plus, Settings } from '@/components/ui/icons';
import { LoadState } from '@/components/ui/load-failure';
import { clearToken } from '@/lib/auth';
import { HabitsDocument } from '@/lib/graphql';
import { useToday } from '@/lib/use-today';

/** The persistent shell: today, and every habit, always one click away. */
export function Sidebar() {
  const pathname = usePathname();
  const today = useToday();
  const habitsQuery = useQuery(HabitsDocument, { variables: { today } });
  const [isCreating, setIsCreating] = useState(false);
  const habits = habitsQuery.data?.habits ?? [];
  const nextPosition = habits.reduce((max, habit) => Math.max(max, habit.position), -1) + 1;

  function signOut() {
    clearToken();
    window.location.replace('/login');
  }

  return (
    <>
      <SidebarFrame
        label="Ethos"
        headerSlot={
          <>
            <Link href="/" className="px-1 font-semibold text-foreground text-lg tracking-tight no-underline">
              Ethos
            </Link>
            {/* The one action the sidebar offers, so it says what it does rather
                than leaving a bare `+` for the reader to interpret, and it is
                the only filled thing here. The colour is the whole hierarchy:
                spend it on the action and the habit rows stay quiet. */}
            <Button
              size="sm"
              className="w-full gap-2 rounded-lg"
              onPress={() => setIsCreating(true)}
              iconSlot={<Plus className="h-4 w-4" />}
              content="New habit"
            />
          </>
        }
        contentSlot={
          <>
            <SidebarSection
              as="nav"
              label="Main"
              contentSlot={[
                <Link key="today" href="/" asChild>
                  <SidebarNavItem href="/" label="Today" iconSlot={<CalendarCheck />} active={pathname === '/'} />
                </Link>,
              ]}
            />
            <SidebarSection
              as="nav"
              title="Habits"
              status={
                /* Only when there is nothing to show. A refetch that fails while the
                   last good list is still on screen leaves it there — the rail is how
                   you get anywhere, and replacing it with an apology would strand the
                   reader on whatever page they are already on. */
                <LoadState
                  query={habitsQuery}
                  what="your habits"
                  count={habits.length}
                  compact
                  emptySlot={<EmptyState compact title="No habits yet." className="px-2" />}
                />
              }
              contentSlot={habits.map((habit) => (
                <Link key={habit.id} href={`/habits/${habit.id}`} asChild>
                  <SidebarNavItem
                    href={`/habits/${habit.id}`}
                    label={habit.name}
                    // The habit's colour is how it is recognised on every other
                    // screen, so the rail carries it too — a dot rather than a
                    // filled row, which would make the sidebar a colour chart.
                    iconSlot={<ColorDot color={habit.color} size="sm" />}
                    count={habit.streak > 0 ? habit.streak : undefined}
                    active={pathname === `/habits/${habit.id}`}
                  />
                </Link>
              ))}
            />
          </>
        }
        footerSlot={
          <>
            <Link href="/archive" asChild>
              <SidebarNavItem href="/archive" label="Archive" iconSlot={<Archive />} active={pathname === '/archive'} />
            </Link>
            <Link href="/settings" asChild>
              <SidebarNavItem
                href="/settings"
                label="Settings"
                iconSlot={<Settings />}
                active={pathname === '/settings'}
              />
            </Link>
            {/* A button, not a link: it does something rather than going somewhere. */}
            <SidebarNavItem label="Sign out" iconSlot={<LogOut />} onPress={signOut} />
          </>
        }
      />
      <HabitFormDialog open={isCreating} onOpenChange={setIsCreating} today={today} nextPosition={nextPosition} />
    </>
  );
}
