// Renderizador do overlay. Sem framework de proposito: e uma janela sempre
// visivel sobre jogos, entao o custo precisa ser proximo de zero.
interface OverlayParticipant {
  key: string;
  name: string;
  avatar: string | null;
  speaking: boolean;
  muted: boolean;
}

declare global {
  interface Window {
    overlay: { onParticipants(handler: (p: OverlayParticipant[]) => void): void };
  }
}

const lista = document.getElementById('lista')!;

/** Mesma cor deterministica derivada da chave usada dentro do app. */
function corDaChave(chave: string): string {
  const matiz = parseInt(chave.slice(0, 6) || '0', 16) % 360;
  return `linear-gradient(135deg, hsl(${matiz} 65% 45%), hsl(${(matiz + 40) % 360} 70% 35%))`;
}

window.overlay.onParticipants((participantes: OverlayParticipant[]) => {
  lista.replaceChildren();

  for (const p of participantes) {
    const linha = document.createElement('div');
    linha.className = p.speaking ? 'pessoa falando' : 'pessoa';

    if (p.avatar) {
      const img = document.createElement('img');
      img.className = 'foto';
      img.src = p.avatar;
      linha.appendChild(img);
    } else {
      const inicial = document.createElement('div');
      inicial.className = 'foto';
      inicial.style.background = corDaChave(p.key);
      // textContent, nunca innerHTML: o nome vem de outra pessoa.
      inicial.textContent = (p.name || '?').slice(0, 1).toUpperCase();
      linha.appendChild(inicial);
    }

    const nome = document.createElement('span');
    nome.className = 'nome';
    nome.textContent = p.name;
    linha.appendChild(nome);

    if (p.muted) {
      const mudo = document.createElement('span');
      mudo.className = 'mudo';
      mudo.textContent = '🔇';
      linha.appendChild(mudo);
    }

    lista.appendChild(linha);
  }
});

export {};
