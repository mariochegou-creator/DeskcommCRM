"use client";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

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

export function useIsServerRender(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => false,
    () => true,
  );
}

/**
 * A data de hoje, por extenso ("sexta-feira, 5 de setembro").
 *
 * Sai vazia no servidor e só aparece depois de hidratar. Não é preciosismo: o
 * servidor formata no fuso DELE e o navegador no de quem lê, então perto da
 * meia-noite os dois HTML divergem em UM DIA — o React acusa erro de hidratação
 * e, pior, a pessoa vê a data errada piscar. Como este texto é ornamento
 * (nenhuma decisão depende dele), esperar a hidratação sai mais barato que
 * carregar uma biblioteca de fuso.
 *
 * `min-h` reserva a linha para o cabeçalho não pular quando o texto chega.
 */
export function TodayDate({ className }: { className?: string }) {
  const isServer = useIsServerRender();

  return (
    <span className={cn("block min-h-4 capitalize", className)}>
      {isServer
        ? ""
        : new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
    </span>
  );
}
