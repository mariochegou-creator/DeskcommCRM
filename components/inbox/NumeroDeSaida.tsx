"use client";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChannelSessions, type ChannelSession } from "@/hooks/channels/useChannelSessions";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useTrocarNumeroDaConversa } from "@/hooks/inbox/useTrocarNumeroDaConversa";
import { CaretDown, WhatsappLogo } from "@/lib/ui/icons";
import { formatarTelefone } from "@/lib/contacts/telefone";
import { cn } from "@/lib/utils";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

interface Props {
  conversation: ConversationWithContact;
  /** Abrir outra conversa — usada quando o contato já tinha uma no número escolhido. */
  onIrPara: (conversationId: string) => void;
}

/**
 * Como uma pessoa reconhece o número; `waha_session_name` (`org_…`) nunca
 * aparece — nome interno não diz a ninguém por onde a mensagem vai sair.
 *
 * `display_name` vem PRIMEIRO (mesma ordem do seletor de filtro): o mesmo
 * WhatsApp pode estar conectado em duas sessões, e aí só o rótulo escrito à mão
 * distingue uma da outra — o telefone é idêntico nas duas, quando não está nulo
 * (a unique de `phone_number` deixa a segunda sessão sem número).
 */
export function rotuloDoNumero(c: ChannelSession): string {
  return c.display_name?.trim() || formatarTelefone(c.phone_number) || "Número sem nome";
}

/**
 * O "meu número" de quem está logado, por org. Mora no navegador de propósito:
 * é preferência de quem atende, não fato da organização — e o vínculo
 * usuário↔número não existe no schema. Aprende sozinho da última escolha, para
 * não custar mais uma tela de configuração que ninguém abriria.
 */
function chaveDoMeuNumero(orgId: string, userId: string) {
  return `meu-numero:${orgId}:${userId}`;
}

function lerMeuNumero(orgId: string | null, userId: string): string | null {
  if (!orgId || typeof window === "undefined") return null;
  try {
    return localStorage.getItem(chaveDoMeuNumero(orgId, userId));
  } catch {
    return null; // storage indisponível — o seletor funciona sem a marcação
  }
}

/**
 * Diz por qual número esta conversa fala — e deixa trocar.
 *
 * Antes desta linha, o número de saída era invisível: a conversa fala pelo canal
 * que recebeu a primeira mensagem, então quem tem dois números respondia pelo
 * do colega sem nunca ver. Aparece só com 2+ números conectados; com um só não
 * há o que dizer nem o que escolher.
 */
export function NumeroDeSaida({ conversation, onIrPara }: Props) {
  const { user, activeOrg } = useAuth();
  const { data: canais } = useChannelSessions();
  const trocar = useTrocarNumeroDaConversa();
  const orgId = activeOrg?.orgId ?? null;
  // Lido no render (e não num efeito) de propósito: o componente só chega a
  // renderizar depois que a lista de canais volta da API — já no cliente, sem
  // risco de descasar do HTML do servidor. `escolhidoAgora` existe só para
  // redesenhar a marcação depois de gravar.
  const [escolhidoAgora, setEscolhidoAgora] = useState<string | null>(null);
  const meuNumeroId = escolhidoAgora ?? lerMeuNumero(orgId, user.id);

  // Só número conectado entra: mandar por um STOPPED deixa a mensagem parada em
  // `queued` sem explicação, que é o pior dos dois erros possíveis aqui.
  const disponiveis = (canais ?? []).filter((c) => c.status === "WORKING");
  if (disponiveis.length < 2) return null;

  const atual = disponiveis.find((c) => c.id === conversation.channel_session_id) ?? null;
  const foraDoMeu = !!meuNumeroId && conversation.channel_session_id !== meuNumeroId;

  function escolher(destino: ChannelSession) {
    if (destino.id === conversation.channel_session_id) return;
    // O custo da troca é do lado do cliente e não dá para desfazer depois de
    // enviada: no celular dele a mensagem chega de um número desconhecido, fora
    // do histórico. Quem confirma aqui está decidindo isso de olhos abertos.
    const ok = window.confirm(
      `Responder por ${rotuloDoNumero(destino)}?\n\n` +
        "No celular do lead isso chega como conversa nova, de um número que ele não conhece.",
    );
    if (!ok) return;
    if (orgId) {
      setEscolhidoAgora(destino.id);
      try {
        localStorage.setItem(chaveDoMeuNumero(orgId, user.id), destino.id);
      } catch {
        /* sem persistência: a troca acontece do mesmo jeito */
      }
    }
    trocar.mutate(
      { conversation_id: conversation.id, channel_session_id: destino.id },
      { onSuccess: (data) => onIrPara(data.conversation_id) },
    );
  }

  return (
    <div className="flex items-center gap-1.5 border-t border-border bg-muted/30 px-3 py-1 text-xs">
      <span className="text-muted-foreground">Falando pelo</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={trocar.isPending}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors hover:bg-muted",
              foraDoMeu ? "text-warning" : "text-foreground",
            )}
            aria-label="Trocar o número de WhatsApp desta conversa"
          >
            <WhatsappLogo size={13} weight="fill" aria-hidden />
            {atual ? rotuloDoNumero(atual) : "número desconectado"}
            <CaretDown size={10} weight="bold" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Por qual número responder
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {disponiveis.map((c) => (
            <DropdownMenuItem
              key={c.id}
              disabled={trocar.isPending}
              onSelect={() => escolher(c)}
              className="justify-between gap-2"
            >
              <span className="truncate">{rotuloDoNumero(c)}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {c.id === conversation.channel_session_id
                  ? "em uso"
                  : c.id === meuNumeroId
                    ? "o seu"
                    : ""}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {foraDoMeu && <span className="text-warning">— não é o seu número</span>}
    </div>
  );
}
