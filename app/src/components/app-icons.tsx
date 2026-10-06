import ArchiveSource from 'lucide-react-native/icons/archive';
import ArchiveRestoreSource from 'lucide-react-native/icons/archive-restore';
import CalendarCheckSource from 'lucide-react-native/icons/calendar-check';
import FlameSource from 'lucide-react-native/icons/flame';
import LogOutSource from 'lucide-react-native/icons/log-out';
import SkipForwardSource from 'lucide-react-native/icons/skip-forward';
import { icon } from '@/components/ui/icons';

/**
 * Icons this app draws that cubeui's `icons` item does not ship, wrapped with
 * that item's own `icon()` so they size and colour like the rest.
 */
export const Archive = icon(ArchiveSource);
export const ArchiveRestore = icon(ArchiveRestoreSource);
export const CalendarCheck = icon(CalendarCheckSource);
export const Flame = icon(FlameSource);
export const LogOut = icon(LogOutSource);
export const SkipForward = icon(SkipForwardSource);
