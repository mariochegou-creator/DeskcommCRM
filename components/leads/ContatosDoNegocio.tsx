"use client";
/**
 * "Quem chamar" — os contatos do negócio, com o papel de cada um (0103).
 *
 * A pergunta é a MESMA na gaveta do kanban e no painel do inbox, então a peça é
 * uma só. Duplicar seria como o dossiê e o painel passariam a contar diferente
 * — e contar diferente aqui é pior que em outros lugares, porque o número
 * ("2 contatos") é a informação inteira: quem lê "2" e encontra 1 não conclui
 * que a lista está errada, conclui que perdeu um contato.
 *
 * O CABEÇALHO SÓ APARECE COM MAIS DE UM. Negócio com um contato só é o caso
 * comum, e ali "Quem chamar (1)" não informa nada que o painel de contato acima
 * já não diga — anunciar contagem de um treina o olho a ignorar o número
 * justamente quando ele passar a valer.
 *
 * Cada linha reusa `ContactActions` no modo compacto, e não botões próprios: a
 * regra do telefone (nono dígito, 0102) muda num lugar só.
 */
import { useState, type ReactNode } from "react";

import { ContactActions } from "@/components/contacts/ContactActions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Trash } from "@/lib/ui/icons";
import { formatarTelefone } from "@/lib/contacts/telefone";
import { ROTULO_DO_CONTATO_DE_ORIGEM, rotuloDoPapel } from "@/lib/leads/papel-do-contato";
import {
  useContatosDoNegocio,
  useDesvincularContato,
  type ContatoDoNegocio,
} from "@/hooks/leads/useContatosDoNegocio";

interface Props {
  leadId: string | null;
  /** O nome do negócio — vai para a atividade da ligação, como no dossiê. */
  tituloDoNegocio: string;
  /** De onde partiu, só para o payload da atividade de ligação. */
  origin?: "contact" | "deal";
  /**
   * O que mostrar quando o negócio tem um contato só — tipicamente o
   * `ContactActions` cheio que a tela já mostrava antes desta lista existir.
   *
   * A ALTERNATIVA MORA AQUI DENTRO de propósito. Deixar o pai decidir
   * ("se são 2+, use a lista; senão, os botões") escreveria a MESMA condição
   * no dossiê e no painel do inbox, e é assim que as duas telas passam a
   * discordar sobre quando a lista aparece. O componente sabe a contagem; ele
   * escolhe.
   */
  fallback?: ReactNode;
  /** Moldura da seção (borda, respiro). Some junto quando não há o que mostrar. */
  className?: string;
}

function LinhaDoContato({
  contato,
  tituloDoNegocio,
  origin,
  onRemover,
  removendo,
}: {
  contato: ContatoDoNegocio;
  tituloDoNegocio: string;
  origin: "contact" | "deal";
  onRemover: (linkId: string) => void;
  removendo: boolean;
}) {
  const papel = contato.link_id === null ? ROTULO_DO_CONTATO_DE_ORIGEM : rotuloDoPapel(contato.papel);
  const telefone = formatarTelefone(contato.phone_number);

  return (
    <li className="flex items-center gap-2 rounded-md border border-border p-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">
          {contato.nome ?? "Sem nome"}
        </div>
        <div className="truncate text-[11px] text-text-muted">
          {papel}
          {telefone ? ` · ${telefone}` : ""}
          {contato.is_blocked ? " · bloqueado" : ""}
        </div>
      </div>

      {/* Contato anonimizado (LGPD) não recebe ligação nem mensagem — o mesmo
          `disabled` que o dossiê já aplicava ao contato de origem. */}
      <ContactActions
        contactId={contato.contact_id}
        contactName={contato.nome ?? "contato"}
        phoneNumber={contato.phone_number}
        company={tituloDoNegocio}
        origin={origin}
        disabled={contato.is_anonymized || contato.is_blocked}
        compacto
      />

      {/* Só quem TEM vínculo pode ser desvinculado. O contato de origem vem com
          `link_id: null` de propósito (ver a rota): tirá-lo não é desvincular,
          é apagar de onde o negócio nasceu — outra operação, outro botão. */}
      {contato.link_id && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0 text-text-muted hover:text-error-fg"
          aria-label={`Remover ${contato.nome ?? "contato"} do negócio`}
          title="Remover do negócio"
          disabled={removendo}
          onClick={() => onRemover(contato.link_id!)}
        >
          <Trash size={14} weight="regular" aria-hidden />
        </Button>
      )}
    </li>
  );
}

export function ContatosDoNegocio({
  leadId,
  tituloDoNegocio,
  origin = "deal",
  fallback = null,
  className,
}: Props) {
  const q = useContatosDoNegocio(leadId);
  const desvincular = useDesvincularContato(leadId);
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  /**
   * A moldura (borda, respiro) mora AQUI e não no pai, e a razão é a linha de
   * baixo: quando não há nada a mostrar — negócio sem contato nenhum e sem
   * fallback — o componente devolve `null` e a moldura vai junto. Com a div no
   * pai, sobraria uma faixa vazia com borda no meio da gaveta, que se lê como
   * seção que falhou em carregar.
   */
  const moldura = (conteudo: ReactNode) =>
    className ? <div className={className}>{conteudo}</div> : <>{conteudo}</>;

  if (q.isPending && leadId) {
    return moldura(<Skeleton className="h-14 w-full" />);
  }

  const contatos = q.data ?? [];

  // Erro NÃO vira lista vazia: "este negócio tem um contato só" e "não consegui
  // ler os contatos" se leem idênticos quando o silêncio é o mesmo, e a
  // primeira frase é uma afirmação sobre o negócio feita em cima de uma falha
  // de leitura — o defeito que o painel do inbox já tinha corrigido uma vez.
  if (q.isError) {
    return moldura(
        <div className="space-y-2">
          {/* O fallback continua de pé: falhar em ler os OUTROS contatos não
              pode tirar da tela o botão de falar com o contato de origem, que a
              tela já tinha antes desta lista existir. */}
          {fallback}
          <p className="text-xs text-error-fg">Não consegui ler os contatos deste negócio.</p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Tentar de novo
          </Button>
        </div>
    );
  }

  // Um contato só (ou nenhum): a tela volta ao que mostrava antes. Ver o
  // cabeçalho e a prop `fallback`.
  if (contatos.length < 2) return fallback ? moldura(fallback) : null;

  const remover = (linkId: string) => {
    setRemovendoId(linkId);
    desvincular.mutate(linkId, {
      onError: (e) => showApiError(e),
      onSettled: () => setRemovendoId(null),
    });
  };

  return moldura(
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          Quem chamar ({contatos.length})
        </h3>
        <ul className="space-y-1.5">
          {contatos.map((c) => (
            <LinhaDoContato
              key={c.link_id ?? c.contact_id}
              contato={c}
              tituloDoNegocio={tituloDoNegocio}
              origin={origin}
              onRemover={remover}
              removendo={removendoId === c.link_id}
            />
          ))}
        </ul>
      </section>
  );
}
