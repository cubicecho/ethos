import CalendarCheckSource from 'lucide-react-native/icons/calendar-check';
import Minimize2Source from 'lucide-react-native/icons/minimize-2';
import { icon } from '@/components/ui/icons';

/**
 * Icons this app draws that cubeui's `icons` item does not ship, wrapped with
 * that item's own `icon()` so they size and colour like the rest.
 */
export const CalendarCheck = icon(CalendarCheckSource);
export const Minimize2 = icon(Minimize2Source);
