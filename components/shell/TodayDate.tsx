"use client";
import { useSyncExternalStore } from "react";

/**
 * `true` durante o SSR e no primeiro render do cliente; `false` depois de
 * hidratar.
 *
 * `useSyncExternalStore` com um `subscribe` que nunca notifica é a forma
 * canônica de saber "já hidratou?" sem `setState` dentro de `useEffect` — o
 * React chama o snapshot do servidor no SSR e o do cliente depois, e a
 * transição acontece na própria hidratação, sem um render extra em cascata.
 */
const noopSubscribe = () => () => {};

function useIsServerRender(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => false,
    () => true,
  );
}

/**
 * A data de hoje, em ciano, no centro da topbar.
 *
 * Sai vazia no servidor e só aparece depois de hidratar. Não é preciosismo: o
 * servidor formata no fuso DELE e o navegador no de quem lê, então perto da
 * meia-noite os dois HTML divergem em UM DIA — o React acusa erro de hidratação
 * e, pior, a pessoa vê a data errada piscar. Como este texto é ornamento
 * (nenhuma decisão depende dele) e não entra em SEO, esperar a hidratação sai
 * mais barato que carregar uma biblioteca de fuso.
 *
 * `min-w` reserva o espaço para a topbar não pular quando o texto chega.
 */
export function TodayDate() {
  const isServer = useIsServerRender();

  return (
    <span className="hidden min-w-[180px] text-center text-xs font-medium capitalize text-accent lg:inline">
      {isServer
        ? ""
        : new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          })}
    </span>
  );
}
