"use client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Checks, Robot, WarningOctagon } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Message } from "@/lib/types/messaging";
import { CitationButton } from "@/components/ai/CitationButton";
import { MediaRenderer } from "@/components/inbox/media/MediaRenderer";
import { CartaoDeContato } from "@/components/inbox/CartaoDeContato";
import { TranscricaoDaMidia } from "@/components/inbox/TranscricaoDaMidia";
import { analisarVCard } from "@/lib/contacts/vcard";
import {
  extractCitations,
  isAiGeneratedMessage,
} from "@/lib/ai/citations/types";

interface Props {
  message: Message;
  debugCitations?: boolean;
  /**
   * O contato DA CONVERSA — só o cartão de contato usa, para saber em quais
   * negócios o número que chegou pode entrar (0103).
   */
  contactId?: string | null;
}

function AckIndicator({ status }: { status: string }) {
  if (status === "read") {
    return <Checks size={12} weight="bold" className="text-blue-400" aria-label="Lida" />;
  }
  if (status === "delivered") {
    return <Checks size={12} weight="bold" className="text-current/70" aria-label="Entregue" />;
  }
  if (status === "sent") {
    return <Check size={12} weight="bold" className="text-current/70" aria-label="Enviada" />;
  }
  return null;
}

export function MessageBubble({ message, debugCitations, contactId }: Props) {
  const isOutbound = message.direction === "outbound";
  const time = format(new Date(message.sent_at), "HH:mm", { locale: ptBR });
  const isFailed = message.status === "failed";
  const hasMedia = Boolean(message.media_url || message.media_storage_path);
  // Figurinha sem caption: sem moldura de bolha (padrão WhatsApp).
  const isBareSticker = hasMedia && message.type === "sticker" && !message.body;
  // O cartão de contato substitui o corpo, não convive com ele: o `body` de uma
  // mensagem `contact` É o texto do vCard, e mostrar os dois seria desenhar o
  // cartão bonito com as sete linhas cruas logo abaixo. Só quando o parse deu
  // certo — vCard que não abrimos volta a ser texto, em vez de virar silêncio.
  const cartoes = message.type === "contact" ? analisarVCard(message.body) : [];
  const temCartao = cartoes.length > 0;
  const aiGenerated = isAiGeneratedMessage(message.metadata);
  const citations = extractCitations(message.metadata);
  const showCitationButton =
    isOutbound && aiGenerated && (debugCitations ?? false);
  const senderLabel = (() => {
    // Num grupo, TODA bolha recebida tem o `contact_id` do lead (a coluna é NOT
    // NULL e o grupo não tem contato próprio). Sem este rótulo, a mensagem do
    // David e a do dono do negócio ficam idênticas na tela — e quem lê o
    // histórico depois atribui ao cliente o que foi a gente que escreveu.
    const noGrupo = message.metadata?.["autor_nome"];
    if (!isOutbound && typeof noGrupo === "string" && noGrupo.trim()) {
      return noGrupo.trim();
    }
    if (!isOutbound) return null;
    if (message.sent_via === "ai") return "IA";
    return null;
  })();

  return (
    <div className={cn("flex w-full px-4 py-1", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] text-sm",
          isBareSticker
            ? "px-0 py-0"
            : cn(
                "rounded-2xl px-3 py-2 shadow-sm",
                isOutbound
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-muted text-foreground",
              ),
          isFailed && "border border-destructive",
        )}
      >
        {senderLabel && (
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
            {senderLabel === "IA" ? (
              <Robot size={10} weight="duotone" aria-hidden />
            ) : null}
            {senderLabel}
          </div>
        )}

        {hasMedia && (
          <div className={cn(message.body && "mb-1")}>
            <MediaRenderer message={message} />
          </div>
        )}

        {temCartao && (
          <CartaoDeContato
            cartoes={cartoes}
            contactId={contactId ?? null}
            messageId={message.id}
            isOutbound={isOutbound}
          />
        )}

        {message.body && !temCartao && (
          <p className="whitespace-pre-wrap break-words leading-snug">{message.body}</p>
        )}

        {/* Depois do play e do corpo: o que a mídia diz é APOIO à mídia, não a
            mensagem. Acima dela, o olho leria a transcrição como o texto que o
            cliente digitou — e ele não digitou nada. */}
        {hasMedia && <TranscricaoDaMidia message={message} isOutbound={isOutbound} />}

        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            isOutbound ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          <span>{time}</span>
          {showCitationButton && (
            <CitationButton citations={citations} messageId={message.id} />
          )}
          {isOutbound && !isFailed && <AckIndicator status={message.status} />}
          {isFailed && (
            // Provider local: o painel do inbox não tem TooltipProvider ancestral e
            // este Tooltip só monta em mensagem failed — sem o provider, abrir uma
            // conversa com falha de envio derrubava o painel inteiro (error boundary).
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 font-semibold text-destructive">
                    <WarningOctagon size={10} weight="fill" aria-hidden /> Falhou
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {message.error_message ?? message.error_code ?? "Erro desconhecido"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}
