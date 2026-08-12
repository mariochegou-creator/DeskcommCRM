"use client";
/**
 * O contato que o cliente mandou, desenhado como cartão em vez de vCard cru.
 *
 * Antes disto a mensagem aparecia como o texto do cartão — `BEGIN:VCARD`,
 * `VERSION:3.0`, `item1.X-ABLabel` — e o número do decisor, que é a única coisa
 * ali que importa, ficava no meio de sete linhas que ninguém lê. O SDR salvava
 * na agenda do celular e o CRM nunca sabia que o negócio tinha duas portas.
 *
 * O BOTÃO É O PONTO. Mostrar o cartão bonito e deixar o número parado seria
 * meia solução: o gesto que faltava é "esse número entra no negócio", e ele
 * acontece aqui, sem sair da conversa.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AddressBook, UserPlus } from "@/lib/ui/icons";
import { formatarTelefone } from "@/lib/contacts/telefone";
import type { ContatoDoVCard } from "@/lib/contacts/vcard";
import { AdicionarContatoDialog } from "./AdicionarContatoDialog";

interface Props {
  /**
   * Os cartões JÁ LIDOS. Quem chama é que faz o parse, porque é ele que precisa
   * da resposta antes de decidir o que desenhar: bolha com cartão esconde o
   * corpo (o `body` de uma mensagem `contact` É o vCard), bolha sem cartão
   * mostra o texto. Parsear aqui dentro obrigaria os dois a ler o mesmo texto,
   * e a segunda leitura é a que discorda.
   */
  cartoes: ContatoDoVCard[];
  /** O contato DA CONVERSA: é dele que saem os negócios do diálogo. */
  contactId: string | null;
  messageId: string;
  /** Bolha de saída: o cartão fomos NÓS que mandamos, não há o que adicionar. */
  isOutbound: boolean;
}

function UmCartao({
  cartao,
  contactId,
  messageId,
  isOutbound,
}: {
  cartao: ContatoDoVCard;
  contactId: string | null;
  messageId: string;
  isOutbound: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const telefone = formatarTelefone(cartao.telefone) ?? cartao.telefoneCru;

  return (
    <div className="flex items-center gap-2 rounded-md bg-black/5 p-2 dark:bg-white/5">
      <AddressBook size={20} weight="duotone" className="shrink-0 opacity-70" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{cartao.nome ?? "Contato"}</div>
        <div className="truncate text-xs opacity-70">{telefone ?? "Sem número"}</div>
      </div>

      {/* Sem número utilizável o botão sai — um botão que abre um diálogo só
          para dizer "não dá" treina o SDR a desconfiar dele. O cartão continua
          na tela mostrando o que veio. */}
      {!isOutbound && cartao.telefone && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={() => setAberto(true)}
        >
          <UserPlus size={13} weight="bold" aria-hidden />
          Adicionar
        </Button>
      )}

      {aberto && (
        <AdicionarContatoDialog
          open={aberto}
          onOpenChange={setAberto}
          cartao={cartao}
          contactId={contactId}
          messageId={messageId}
        />
      )}
    </div>
  );
}

export function CartaoDeContato({ cartoes, contactId, messageId, isOutbound }: Props) {
  if (cartoes.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {cartoes.map((c, i) => (
        <UmCartao
          // Índice na chave de propósito: o cartão não tem id, e dois contatos
          // com o mesmo número numa mensagem só é possível (a agenda de quem
          // mandou é que sabe). A lista é imutável — nasce do corpo da mensagem
          // e nunca reordena.
          key={`${c.telefone ?? "sem-numero"}-${i}`}
          cartao={c}
          contactId={contactId}
          messageId={messageId}
          isOutbound={isOutbound}
        />
      ))}
    </div>
  );
}
