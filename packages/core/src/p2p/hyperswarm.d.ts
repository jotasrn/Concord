/**
 * Hyperswarm nao publica tipos. Declaramos apenas a superficie que o P2PNode
 * usa, em vez de tratar o modulo inteiro como `any` - assim um erro de uso da
 * API ainda aparece em tempo de compilacao.
 */
declare module 'hyperswarm' {
  import { Duplex } from 'node:stream';

  interface PeerInfo {
    publicKey: Buffer;
    topics: Buffer[];
  }

  interface Discovery {
    flushed(): Promise<void>;
    destroy(): Promise<void>;
  }

  interface JoinOptions {
    server?: boolean;
    client?: boolean;
  }

  class Hyperswarm {
    constructor(options?: { keyPair?: unknown; maxPeers?: number });
    on(event: 'connection', listener: (socket: Duplex, info: PeerInfo) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    join(topic: Buffer, options?: JoinOptions): Discovery;
    leave(topic: Buffer): Promise<void>;
    flush(): Promise<void>;
    destroy(): Promise<void>;
    connections: Set<Duplex>;
  }

  export = Hyperswarm;
}
