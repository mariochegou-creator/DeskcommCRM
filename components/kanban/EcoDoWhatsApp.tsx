"use client";

import { useWatch, type Control, type FieldValues, type Path } from "react-hook-form";

import { formatarTelefone, telefoneE164 } from "@/lib/contacts/telefone";
import { whatsappLink } from "@/lib/contacts/whatsapp";

/**
 * Mostra, embaixo do campo, o número que vai ser gravado — e avisa antes de
 * salvar quando ele não abre WhatsApp.
 *
 * Mesma ideia do [EcoDoValor]: dado que o servidor vai INTERPRETAR não pode ser
 * interpretado em silêncio. Aqui o erro custa mais caro que um número errado na
 * tela — o card entra no funil, o SDR só descobre no dia de chamar, e a lista de
 * prospecção comprovadamente traz 0800 e número sem DDD.
 */
export function EcoDoWhatsApp<T extends FieldValues>({ control }: { control: Control<T> }) {
  const digitado = useWatch({ control, name: "whatsapp" as Path<T> }) as unknown as
    | string
    | undefined;

  if (!digitado?.trim()) {
    return (
      <p className="text-xs text-muted-foreground">
        É por este número que o card abre a conversa.
      </p>
    );
  }

  const e164 = telefoneE164(digitado);
  if (!e164 || !whatsappLink(e164)) {
    return (
      <p className="text-xs text-muted-foreground">
        Ainda não dá pra abrir conversa com este número.
      </p>
    );
  }

  return <p className="text-xs text-muted-foreground">= {formatarTelefone(e164)}</p>;
}
