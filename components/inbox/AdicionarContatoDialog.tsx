"use client";
/**
 * "Adicionar ao negócio" — o cartão que o cliente mandou vira contato do lead.
 *
 * DUAS ESCOLHAS, e só duas: qual negócio e qual papel. O nome vem preenchido e
 * é editável porque quem manda o cartão manda o nome DA AGENDA DELE ("Zé peça
 * 2", "Contador novo") — e esse texto vira o cadastro de uma pessoa que a
 * equipe inteira vai ler depois. Editável, mas preenchido: corrigir é opcional,
 * digitar do zero não.
 *
 * O TELEFONE NÃO É EDITÁVEL aqui. Ele veio do `waid` do vCard, que é a
 * identidade real do WhatsApp; deixar alguém "arrumar" o número na hora de
 * salvar reintroduz, pela mão do operador, exatamente o par partido que a
 * migration 0102 desfez.
 *
 * O negócio vem do CONTATO DA CONVERSA, não de uma busca: adicionar o sócio a
 * um negócio de outra pessoa não é um caso que aconteça no meio de um
 * atendimento — e uma busca aberta aqui seria a porta para fazê-lo por engano.
 */
import { useMemo, useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCrmSummary } from "@/hooks/inbox/useCrmSummary";
import { useVincularContato } from "@/hooks/leads/useContatosDoNegocio";
import { formatarTelefone } from "@/lib/contacts/telefone";
import {
  PAPEIS_DO_CONTATO,
  ROTULO_DO_PAPEL,
  type PapelDoContato,
} from "@/lib/leads/papel-do-contato";
import { MAX_NOME_DO_CONTATO } from "@/lib/schemas/contatos-do-negocio";
import type { ContatoDoVCard } from "@/lib/contacts/vcard";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** O cartão lido da mensagem. */
  cartao: ContatoDoVCard;
  /** O contato DA CONVERSA — é dele que saem os negócios da lista. */
  contactId: string | null;
  /** A mensagem de onde o cartão veio, para a procedência do vínculo. */
  messageId?: string;
}

export function AdicionarContatoDialog({
  open,
  onOpenChange,
  cartao,
  contactId,
  messageId,
}: Props) {
  const resumo = useCrmSummary(open ? contactId : null);
  const leads = useMemo(() => resumo.data?.leads ?? [], [resumo.data]);

  /**
   * O estado nasce do cartão e não é sincronizado por efeito: quem chama monta
   * este diálogo só enquanto ele está aberto, então fechar desmonta e reabrir
   * começa do zero. Um `useEffect` para "resetar ao abrir" seria um segundo
   * caminho para a mesma coisa — e o que ele resolveria (rascunho de outro
   * cartão sobrando) já não pode acontecer.
   */
  const [papel, setPapel] = useState<PapelDoContato>("decisor");
  const [nome, setNome] = useState(cartao.nome ?? "");

  /**
   * A escolha do negócio é DERIVADA, não sincronizada: o padrão é o negócio
   * mais recente (a rota ordena por `updated_at`) e o estado guarda só a
   * escolha EXPLÍCITA de quem clicou. Guardar o padrão no estado obrigaria um
   * efeito para corrigi-lo quando a lista chega — e é nesse instante entre a
   * lista velha e a nova que o contato entraria no negócio errado.
   */
  const [escolha, setEscolha] = useState<string | null>(null);
  const leadId = escolha && leads.some((l) => l.id === escolha) ? escolha : leads[0]?.id ?? null;

  const vincular = useVincularContato(leadId);

  const telefone = cartao.telefone;
  const nomeLimpo = nome.trim();
  const podeSalvar = !!telefone && !!leadId && nomeLimpo.length > 0 && !vincular.isPending;

  const salvar = () => {
    if (!podeSalvar || !telefone) return;
    vincular.mutate(
      { telefone, nome: nomeLimpo, papel, origem: "vcard", messageId },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => showApiError(e),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar ao negócio</DialogTitle>
          <DialogDescription>
            {formatarTelefone(telefone) ?? cartao.telefoneCru ?? "Sem número"}
          </DialogDescription>
        </DialogHeader>

        {/* Sem número utilizável não há o que salvar, e o diálogo diz por quê em
            vez de mostrar um botão apagado sem explicação. */}
        {!telefone ? (
          <p className="text-sm text-error-fg">
            O cartão veio sem um número que dê para usar — falta o DDD ou o formato não
            é reconhecido. Peça o número por escrito na conversa.
          </p>
        ) : leads.length === 0 && !resumo.isPending ? (
          <p className="text-sm text-text-muted">
            Este contato ainda não tem negócio no funil. Crie o negócio primeiro — é
            nele que o novo contato entra.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nome-do-contato">Nome</Label>
              <Input
                id="nome-do-contato"
                value={nome}
                maxLength={MAX_NOME_DO_CONTATO}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Como esta pessoa aparece no CRM"
              />
            </div>

            {/* Um negócio só: sem escolha para fazer. O rótulo continua na tela
                porque quem adiciona precisa VER em qual negócio está entrando —
                esconder a informação junto com o controle é como o contato
                acaba no card errado sem ninguém notar. */}
            {leads.length === 1 && leads[0] ? (
              <p className="text-xs text-text-muted">
                Entra no negócio <span className="font-medium text-text">{leads[0].title}</span>.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="negocio-do-contato">Negócio</Label>
                <Select value={leadId ?? ""} onValueChange={(v) => setEscolha(v)}>
                  <SelectTrigger id="negocio-do-contato" aria-label="Negócio">
                    <SelectValue placeholder="Escolha o negócio" />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="papel-do-contato">Quem é</Label>
              <Select value={papel} onValueChange={(v) => setPapel(v as PapelDoContato)}>
                <SelectTrigger id="papel-do-contato" aria-label="Papel no negócio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPEIS_DO_CONTATO.map((p) => (
                    <SelectItem key={p} value={p}>
                      {ROTULO_DO_PAPEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={!podeSalvar} onClick={salvar}>
            {vincular.isPending ? "Adicionando…" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
