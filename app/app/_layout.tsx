import { ApolloProvider } from '@apollo/client';
import { type ErrorBoundaryProps, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { RouteError } from '@/components/route-error';
import { Button } from '@/components/ui/button';
import { PaletteProvider, useThemePreference } from '@/components/ui/theme-preference';
import { client } from '@/lib/apollo';
import { describeError } from '@/lib/errors';
import '../global.css';

export default function RootLayout() {
  // `public/index.html` has already painted the right theme; this keeps it on
  // every screen and repaints a `system` user when the OS switches.
  useThemePreference();

  return (
    <PaletteProvider>
      <ApolloProvider client={client}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
      </ApolloProvider>
    </PaletteProvider>
  );
}

/**
 * The last thing between a thrown render and a white page.
 *
 * Expo Router wraps a route in this named export, so exporting it from the root
 * layout covers every screen. It sits *outside* the provider above, where the
 * throw may have come from, so it can use nothing that needs Apollo. The raw
 * message is shown beside `describeError`'s wording, for whoever has to file it.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View className="h-full flex-1 bg-background">
      <RouteError
        error={error}
        reset={() => void retry()}
        describe={describeError}
        details
        actionsSlot={<Button variant="outline" size="sm" onPress={() => window.location.reload()} content="Reload" />}
      />
      <Text className="mx-auto max-w-md px-6 pb-12 text-center text-foreground/60 text-sm">
        This is a bug in Ethos, not something you did. Your data is untouched.
      </Text>
    </View>
  );
}
