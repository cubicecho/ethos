import { useEffect, useState } from 'react';
import { today } from './periods';

/**
 * The day it is, kept current while the app is open.
 *
 * One hook rather than a `today()` call per component, because the day is a
 * cache key: two components that disagreed across midnight would read and write
 * different entries for the same habit. Polled rather than scheduled, because a
 * timer set for midnight does not fire while a laptop is asleep.
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
