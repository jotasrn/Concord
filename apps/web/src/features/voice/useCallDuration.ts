import { useEffect, useState } from 'react';

/**
 * Tempo decorrido desde o inicio da chamada, em segundos.
 *
 * Conta a partir de um instante absoluto em vez de incrementar um contador:
 * assim o valor continua correto mesmo se a aba ficar suspensa ou o timer
 * atrasar, que e o que acontece quando a janela perde o foco.
 */
export function useCallDuration(joinedAt: number | null): number {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    if (joinedAt === null) {
      setSegundos(0);
      return;
    }

    const atualizar = () => setSegundos(Math.floor((Date.now() - joinedAt) / 1000));
    atualizar();
    const id = setInterval(atualizar, 1000);
    return () => clearInterval(id);
  }, [joinedAt]);

  return segundos;
}

/** Formata como mm:ss, ou h:mm:ss quando passa de uma hora. */
export function formatDuration(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  const dois = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}
