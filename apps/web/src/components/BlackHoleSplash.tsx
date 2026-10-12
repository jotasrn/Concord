/**
 * Tela de abertura enquanto a conta carrega.
 *
 * Desbloquear derruba a senha com scrypt (de proposito lento), abre o banco e
 * reconstroi o estado a partir do log - tudo no processo principal, e a
 * interface ficava parada sem nenhum retorno. Esta tela cobre tudo ate o app
 * estar pronto para usar.
 */
export function BlackHoleSplash({ mensagem = 'Abrindo o Concord' }: { mensagem?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-8 bg-black"
    >
      <div className="bh-stage" aria-hidden="true">
        <div className="bh-disc" />
        <div className="bh-halo" />
        <div className="bh-core" />
        <div className="bh-disc bh-disc-front" />
      </div>
      <p className="animate-pulse text-sm tracking-[0.3em] text-ink-300 uppercase">{mensagem}</p>
    </div>
  );
}
