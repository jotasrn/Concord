import { useState } from 'react';
import { OnboardingPage } from './pages/OnboardingPage';
import { AppPage } from './pages/AppPage';
import type { Profile } from './types/concord-api';

export function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  return profile ? <AppPage profile={profile} /> : <OnboardingPage onReady={setProfile} />;
}
