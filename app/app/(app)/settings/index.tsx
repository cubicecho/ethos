import { useQuery } from '@apollo/client';
import { Text, View } from 'react-native';
import { PageLayout } from '@/components/page-layout';
import { Section } from '@/components/section';
import { ThemePicker } from '@/components/ui/theme-picker';
import { PALETTE_PREFERENCES } from '@/components/ui/theme-preference-base';
import { MeDocument } from '@/lib/graphql';

/** One card per thing you can change. Sections, not tabs — there are two. */
export default function SettingsScreen() {
  // `users` is scoped to the caller, so the list is the one row the token
  // names — there is no "me" query because there is no one else to ask about.
  const { data } = useQuery(MeDocument);
  const me = data?.users?.[0];

  return (
    <PageLayout
      width="prose"
      title="Settings"
      description="Theme and palette are kept on this device; the account is not."
      contentSlot={
        <View className="gap-6 py-6">
          <Section
            surface="card"
            title="Theme"
            description="System follows whatever your operating system is set to. A dark-only palette, such as Monokai, keeps the page dark whatever the theme says."
            contentSlot={<ThemePicker palettes={PALETTE_PREFERENCES} />}
          />
          <Section
            surface="card"
            title="Account"
            description="Sign in with a link sent to this address."
            contentSlot={<Text className="text-foreground text-sm">{me?.email ?? '—'}</Text>}
          />
        </View>
      }
    />
  );
}
