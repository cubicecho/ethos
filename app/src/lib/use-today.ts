import { useEffect, useState } from 'react';
import { TODAY_DEFAULTS } from './defaults';
import { today } from './periods';

const MS_PER_SECOND = 1000;

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
    const timer = setInterval(check, TODAY_DEFAULTS.pollSeconds * MS_PER_SECOND);
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
