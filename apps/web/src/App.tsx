import { useState } from 'react';
import { BlackHoleSplash } from './components/BlackHoleSplash';
import { OnboardingPage } from './pages/OnboardingPage';
import { AppPage } from './pages/AppPage';
import type { Profile } from './types/concord-api';

export function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  /** Desbloqueando/criando conta: scrypt + banco + rede, sem retorno visual. */
  const [trabalhando, setTrabalhando] = useState(false);
  /** A tela principal terminou de carregar os dados iniciais. */
  const [carregado, setCarregado] = useState(false);

  return (
    <>
      {profile ? (
        <AppPage profile={profile} onLoaded={() => setCarregado(true)} />
      ) : (
        <OnboardingPage onReady={setProfile} onBusy={setTrabalhando} />
      )}
      {/* Uma tela so cobre tudo: do clique em Entrar ate o app estar pronto. */}
      {(trabalhando || (profile && !carregado)) && <BlackHoleSplash />}
    </>
  );
}
