import { Redirect, Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppSidebar } from '@/components/domain/navigation/app-sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { isAuthenticated } from '@/lib/auth';

/** The signed-in shell: the rail beside the current screen, or a redirect to /login. */
export default function AppLayout() {
  // The token lives in localStorage, which the first render cannot read. Decide
  // after mount rather than sending a signed-in user to /login for one frame.
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    setIsSignedIn(isAuthenticated());
  }, []);

  if (isSignedIn === null) {
    return <View className="flex-1 bg-background" />;
  }
  if (isSignedIn === false) {
    return <Redirect href="/login" />;
  }

  return (
    <SidebarLayout
      className="h-full flex-1 bg-background"
      sidebarPosition="start"
      sidebarWidth="auto"
      stackBelow="never"
      // The sidebar draws its own rule.
      divider="none"
      sidebarSlot={<AppSidebar />}
      contentSlot={
        // `role="main"` becomes a <main>. It does not scroll: each screen's
        // `PageLayout` scrolls under its pinned header and needs a height to divide.
        <View role="main" className="min-h-0 min-w-0 flex-1">
          <Slot />
        </View>
      }
    />
  );
}
