"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteLead, useEditLead } from "@/hooks/kanban/useUpdateLead";
import { Phone, Trash } from "@/lib/ui/icons";
import type { Lead } from "@/lib/types/leads";
import { updateLeadSchema, type UpdateLeadInput } from "@/lib/schemas/leads";
import { parseReaisToCents } from "@/lib/money";
import { paraDiscarBR } from "@/lib/calls/phone";
import { telLink, formatarTelefone, telefoneE164 } from "@/lib/contacts/telefone";
import { whatsappLink } from "@/lib/contacts/whatsapp";
import { instagramDoLead, patchDosLinks, siteDoLead } from "@/lib/leads/campos-editaveis";
import { EcoDoValor } from "./EcoDoValor";

interface FormShape {
  title: string;
  description: string;
  whatsapp: string;
  site: string;
  instagram: string;
  valueReais: string;
  tagsRaw: string;
  expected_close_date: string;
}

interface Props {
  lead: Lead;
  pipelineId: string;
  /**
   * Telefone do contato ligado ao lead, em E.164. Vem de fora porque é dado do
   * CONTATO, não do negócio: este formulário edita o lead e não deve saber
   * buscar contato. Ausente = o campo nasce vazio, esperando o número.
   */
  phoneNumber?: string | null;
  /** Quando o salvamento dá certo. O dossiê NÃO fecha aqui — ver abaixo. */
  onSaved?: () => void;
  /** O dossiê não tem "cancelar"; o diálogo tem. */
  onCancel?: () => void;
  /** Quando o negócio é apagado. Aqui o dossiê FECHA — não sobrou o que mostrar. */
  onDeleted?: () => void;
}

function centsToReais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Os campos do lead — extraídos do `EditLeadDialog` para o dossiê usar os
 * MESMOS, em vez de uma cópia que diverge no mês.
 *
 * `onSaved` existe para o dossiê NÃO FECHAR ao salvar: quem edita precisa ver a
 * atividade que acabou de gerar entrar na timeline. Fechar esconderia o
 * registro justamente de quem o produziu — a funcionalidade que prova "sua ação
 * fica registrada" provaria isso para todo mundo menos para o autor.
 *
 * WHATSAPP, SITE E INSTAGRAM SÃO EDITÁVEIS AQUI desde 26/08/2026, e o caso que
 * trouxe isso é o lead de prospecção que nasce sem contato: a caixa de primeiro
 * toque mandava "cadastre o WhatsApp para enviar por aqui" e não existia tela
 * onde cadastrar. Quem achava o número no Maps ficava com o botão de enviar
 * desabilitado para sempre.
 */
export function LeadFieldsForm({
  lead,
  pipelineId,
  phoneNumber,
  onSaved,
  onCancel,
  onDeleted,
}: Props) {
  const edit = useEditLead(pipelineId);
  const apagar = useDeleteLead(pipelineId);
  const [confirmando, setConfirmando] = useState(false);
  /**
   * `paraDiscarBR` ANTES do `telLink`, e é o conserto de 25/08/2026.
   *
   * O banco guarda o telefone na forma do WhatsApp: para DDD >= 31 o celular
   * fica SEM o nono dígito (+55 77 9936-3725 — migration 0102). Discar isso não
   * completa. O botão "Ligar" do `ContactActions`, logo acima nesta mesma
   * gaveta, já reconstruía o 9; este aqui — que também se chama "Ligar" — não.
   * Dois botões com o mesmo nome, um discando certo e o outro no vazio.
   *
   * O `?? phoneNumber` mantém a promessa do `telLink`: número que
   * `paraDiscarBR` não sabe normalizar (central 0800/4003, digitação torta)
   * segue pelo caminho de antes, em vez de sumir o botão.
   */
  const discar = telLink(paraDiscarBR(phoneNumber) ?? phoneNumber);
  const telefoneLegivel = formatarTelefone(phoneNumber);

  const valoresIniciais = (): FormShape => ({
    title: lead.title,
    description: lead.description ?? "",
    whatsapp: telefoneLegivel ?? "",
    site: siteDoLead(lead.custom_fields),
    instagram: instagramDoLead(lead.custom_fields),
    valueReais: centsToReais(lead.value_cents),
    tagsRaw: (lead.tags ?? []).join(", "),
    expected_close_date: lead.expected_close_date ?? "",
  });

  const form = useForm<FormShape>({ defaultValues: valoresIniciais() });

  useEffect(() => {
    form.reset(valoresIniciais());
    // `phoneNumber` entra na lista porque ele chega DEPOIS do lead: a gaveta
    // abre, o campo nasce vazio e a busca do contato responde um instante mais
    // tarde. Sem isto o número aparecia no topo da gaveta e não no campo, e
    // salvar qualquer outra coisa mandaria "apagar o telefone" junto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, phoneNumber]);

  const whatsappDigitado = form.watch("whatsapp");
  const atual = telefoneE164(phoneNumber ?? "");
  const digitado = telefoneE164(whatsappDigitado);
  const trocandoNumero = !!atual && digitado !== atual;

  async function onSubmit(values: FormShape) {
    const tags = values.tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const reais = values.valueReais.trim();
    let valueCents: number | null = null;
    if (reais.length > 0) {
      valueCents = parseReaisToCents(reais);
      if (valueCents === null) {
        form.setError("valueReais", { message: "Valor inválido" });
        return;
      }
    }

    const patch: Record<string, unknown> = {
      title: values.title.trim(),
      description: values.description.trim() ? values.description.trim() : null,
      value_cents: valueCents,
      tags,
      expected_close_date: values.expected_close_date || null,
    };

    // O número é conferido AQUI, antes de sair do navegador, pelo mesmo motivo
    // do formulário de novo lead: a resposta do servidor chegaria como um toast
    // solto e a pessoa já teria perdido de vista qual campo consertar.
    const cru = values.whatsapp.trim();
    if (cru) {
      const e164 = telefoneE164(cru);
      if (!e164 || !whatsappLink(e164)) {
        form.setError("whatsapp", {
          message: "Número não abre WhatsApp. Confira o DDD — ex: (73) 99134-6237.",
        });
        return;
      }
      // Só manda quando MUDOU. Reenviar o mesmo número faria o servidor
      // reprocessar contato a cada salvamento e a timeline acusaria "o contato"
      // alterado em edições que não tocaram nele.
      if (e164 !== atual) patch.contact_phone = e164;
    } else if (atual) {
      // Campo esvaziado = desligar este contato do negócio. O contato e a
      // conversa continuam existindo — o que se desfaz é o vínculo, e digitar o
      // número de volta o refaz.
      patch.contact_id = null;
    }

    const links = patchDosLinks(lead.custom_fields, {
      site: values.site,
      instagram: values.instagram,
    });
    if (Object.keys(links).length > 0) patch.custom_fields = links;

    const parsed = updateLeadSchema.safeParse(patch);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Dados inválidos");
      return;
    }

    try {
      await edit.mutateAsync({
        leadId: lead.id,
        patch: parsed.data as UpdateLeadInput,
      });
      toast.success("Lead atualizado");
      onSaved?.();
    } catch {
      // toast already shown
    }
  }

  async function confirmarExclusao() {
    try {
      await apagar.mutateAsync({ leadId: lead.id });
      setConfirmando(false);
      toast.success("Negócio apagado");
      onDeleted?.();
    } catch {
      // toast already shown
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Título</Label>
          <Input
            id="title"
            {...form.register("title", { required: true, minLength: 2 })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Descrição</Label>
          <Textarea id="description" rows={3} {...form.register("description")} />
        </div>

        {/* O TELEFONE É DO CONTATO, não do negócio — e continua sendo: o que se
            edita aqui é QUAL contato o negócio aponta. O servidor acha-ou-cria
            pela identidade do WhatsApp (lib/contacts/contato-por-telefone), a
            mesma regra da importação de lista, para o número achado no Maps não
            virar um segundo cadastro do contato que o CRM já tem.

            Ligar importa mais que o WhatsApp para boa parte desta base: 27 dos
            leads importados só têm fixo, e fixo raramente atende no WhatsApp.
            Por isso o `tel:` aceita central 0800/4003, que o link de WhatsApp
            recusa — lá seria um botão quebrado, aqui é uma ligação que completa. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            {discar && (
              <Button asChild type="button" variant="secondary" size="sm" className="h-7 gap-2">
                <a href={discar}>
                  <Phone size={14} weight="fill" />
                  Ligar
                </a>
              </Button>
            )}
          </div>
          <Input
            id="whatsapp"
            type="tel"
            inputMode="tel"
            placeholder="(73) 99134-6237"
            {...form.register("whatsapp")}
          />
          {form.formState.errors.whatsapp && (
            <p className="text-xs text-error-fg">{form.formState.errors.whatsapp.message}</p>
          )}
          {/* Trocar o número aponta o negócio para OUTRO contato, e a conversa
              que já existe fica com o antigo. Dizer isso antes de salvar é o que
              separa "eu quis trocar" de "a conversa sumiu" — o segundo é o
              relato que chega depois, quando ninguém mais liga uma coisa à outra. */}
          {trocandoNumero && !form.formState.errors.whatsapp && (
            <p className="text-xs leading-snug text-warning-fg">
              {digitado
                ? "Ao salvar, o negócio passa a apontar para este número. A conversa que já existe fica com o número antigo."
                : "Ao salvar, o negócio fica sem contato. A conversa não é apagada — digitar o número de volta refaz o vínculo."}
            </p>
          )}
          {!atual && !digitado && (
            <p className="text-xs leading-snug text-text-muted">
              Sem número não dá para mandar mensagem por aqui — é este campo que libera o envio.
            </p>
          )}
        </div>

        {/* Site e Instagram vêm da lista de prospecção e ENVELHECEM: a varredura
            grava "não tem (conferido nos resultados da web)" e o negócio publica
            o site no mês seguinte. Editáveis aqui pelo mesmo motivo do telefone
            — quem descobre o dado é quem está com a gaveta aberta. A chave de
            gravação é a que o lead já usa (ver lib/leads/campos-editaveis). */}
        <div className="space-y-2">
          <Label htmlFor="site">Site</Label>
          <Input id="site" placeholder="https://…" {...form.register("site")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="instagram">Instagram</Label>
          <Input id="instagram" placeholder="@perfil ou link" {...form.register("instagram")} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="valueReais">Valor (R$)</Label>
            <Input
              id="valueReais"
              inputMode="decimal"
              placeholder="0,00"
              {...form.register("valueReais")}
            />
            <EcoDoValor control={form.control} />
            {form.formState.errors.valueReais && (
              <p className="text-xs text-error-fg">
                {form.formState.errors.valueReais.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="expected_close_date">Fechamento previsto</Label>
            <Input
              id="expected_close_date"
              type="date"
              {...form.register("expected_close_date")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tagsRaw">Tags (separadas por vírgula)</Label>
          <Input id="tagsRaw" placeholder="vip, recompra" {...form.register("tagsRaw")} />
        </div>

      <div className="flex items-center justify-end gap-2">
        {/* Apagar fica LONGE do Salvar (à esquerda, discreto, com confirmação):
            é a única ação desta gaveta que não se desfaz. */}
        {onDeleted && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto gap-2 text-text-muted hover:text-error-fg"
            disabled={apagar.isPending || edit.isPending}
            onClick={() => setConfirmando(true)}
          >
            <Trash size={14} weight="regular" aria-hidden />
            Excluir negócio
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={edit.isPending}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={edit.isPending}>
          {edit.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{lead.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O card sai do quadro junto com a linha do tempo dele. Não dá para desfazer. O
              contato e a conversa no inbox continuam onde estão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagar.isPending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmarExclusao}
              disabled={apagar.isPending}
            >
              {apagar.isPending ? "Excluindo…" : "Excluir"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
