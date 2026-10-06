import { ColorField } from '@/components/ui/color-picker-field';
import { createAppForm } from '@/components/ui/form';

/**
 * The app's form hook: cubeui's native fields, with the colour picker joined to
 * them once, here, so the habit dialog reaches it on `field.*` like the rest.
 */
export const { useAppForm, withForm } = createAppForm({ ColorField });
