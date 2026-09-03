import { contextBridge, ipcRenderer } from 'electron';

/**
 * Ponte minima do overlay: ele so recebe a lista de quem esta na chamada.
 * Nao expoe nada alem disso - e uma janela sempre visivel, com a menor
 * superficie possivel.
 */
contextBridge.exposeInMainWorld('overlay', {
  onParticipants: (
    handler: (
      participants: {
        key: string;
        name: string;
        avatar: string | null;
        speaking: boolean;
        muted: boolean;
      }[],
    ) => void,
  ) => {
    ipcRenderer.on('overlay:participants', (_e, participants) => handler(participants));
  },
});
