import { useEffect, useState } from 'react';
import { today } from './periods';

/**
 * The day it is, kept current while the app is open.
 *
 * One hook rather than a `today()` call per component, because the day is a
 * cache key: every query and every mutation passes it, and two components that
 * disagreed — one mounted before midnight, one after — would read and write two
 * different entries for the same habit. Reading it in one place means the whole
 * screen rolls over at once.
 *
 * Polled rather than scheduled for the exact moment: a timer set for midnight
 * does not fire while a laptop is asleep, and the wake-up is precisely when the
 * answer has changed. A minute of staleness costs nothing; being wrong until the
 * next reload costs a day.
 */
export function useToday(): string {
  const [day, setDay] = useState(today);

  useEffect(() => {
    const check = () => setDay(today());
    const timer = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  return day;
}
