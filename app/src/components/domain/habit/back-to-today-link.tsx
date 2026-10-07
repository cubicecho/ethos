import { Link } from 'expo-router';

/** The way out of a screen with nothing on it. */
export function BackToTodayLink() {
  return (
    <Link href="/" className="text-info text-sm underline">
      Back to today
    </Link>
  );
}
