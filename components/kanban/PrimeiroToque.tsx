"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEnviarPrimeiroToque } from "@/hooks/kanban/useEnviarPrimeiroToque";
import { PaperPlaneTilt, WhatsappLogo } from "@/lib/ui/icons";
import type { GanchoDoLead } from "@/lib/leads/ganchos";

interface Props {
  leadId: string;
  contactId: string | null;
  pipelineId: string;
  /** Já vem sem vazios; a peça não aparece quando a lista está vazia. */
  ganchos: GanchoDoLead[];
  /** `wa.me` do contato — a saída de emergência, não o caminho principal. */
  whatsappHref: string | null;
}

/**
 * O primeiro toque, feito de dentro do CRM: escolhe o gancho, ajusta o texto,
 * manda, e a gaveta some porque o SDR já está no inbox com a conversa aberta.
 *
 * O TEXTO É EDITÁVEL de propósito. O gancho vem da lista de prospecção e
 * envelhece — saudação fixa ("Boa noite!") que não bate com a hora do envio é o
 * caso mais comum. Um seletor sem caixa de edição obrigaria a corrigir isso no
 * WhatsApp Web, que é exatamente o desvio que esta peça existe para eliminar.
 * Editar aqui NÃO grava em `custom_fields`: o gancho é o modelo, não o enviado.
 *
 * O botão do WhatsApp Web continua, embaixo e discreto. Ele resolve o que este
 * caminho não resolve — número que não está no WhatsApp, conexão caída — e some
 * junto com o número quando não há para onde mandar.
 */
export function PrimeiroToque({ leadId, contactId, pipelineId, ganchos, whatsappHref }: Props) {
  const [chave, setChave] = useState(ganchos[0]?.chave ?? "");
  const [texto, setTexto] = useState(ganchos[0]?.texto ?? "");
  const enviar = useEnviarPrimeiroToque(pipelineId);

  const trocarGancho = (novaChave: string) => {
    setChave(novaChave);
    const escolhido = ganchos.find((g) => g.chave === novaChave);
    if (escolhido) setTexto(escolhido.texto);
  };

  const podeEnviar = !!contactId && texto.trim().length > 0 && !enviar.isPending;

  return (
    <div className="mb-3 space-y-2 rounded-md border border-border p-3">
      {/* Um gancho só não é escolha — mostrar um seletor de item único é pedir
          um clique que não decide nada. O texto continua editável. */}
      {ganchos.length > 1 && (
        <Select value={chave} onValueChange={trocarGancho}>
          <SelectTrigger className="w-full" aria-label="Escolher o gancho de abertura">
            <SelectValue placeholder="Escolha o gancho" />
          </SelectTrigger>
          <SelectContent>
            {ganchos.map((g) => (
              <SelectItem key={g.chave} value={g.chave}>
                {g.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={5}
        maxLength={4096}
        disabled={enviar.isPending}
        aria-label="Mensagem de abertura"
        placeholder="Mensagem de abertura"
        className="min-h-[7rem] text-xs leading-snug"
      />

      <Button
        variant="primary"
        size="sm"
        className="w-full gap-2"
        disabled={!podeEnviar}
        onClick={() => enviar.mutate({ leadId, contactId, body: texto.trim() })}
      >
        <PaperPlaneTilt size={16} weight="fill" />
        {enviar.isPending ? "Enviando…" : "Enviar e abrir no inbox"}
      </Button>

      {/* Sem contato ligado não há para quem mandar, e o botão desabilitado
          sozinho não explica o motivo — quem lê "não posso clicar" procura o
          erro no lugar errado. */}
      {!contactId && (
        <p className="text-[11px] leading-snug text-text-muted">
          Este negócio ainda não tem contato ligado — cadastre o WhatsApp para enviar por aqui.
        </p>
      )}

      {whatsappHref && (
        <Button asChild variant="ghost" size="sm" className="w-full gap-2 text-xs">
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <WhatsappLogo size={14} weight="fill" />
            Abrir no WhatsApp Web
          </a>
        </Button>
      )}
    </div>
  );
}
