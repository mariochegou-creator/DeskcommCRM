/**
 * As perguntas que se faz sobre CADA destinatário antes de mandar (0108).
 *
 * Função pura sobre a linha do contato — o worker faz o I/O, isto só decide.
 * Existe separado porque as mesmas checagens rodam em dois momentos com
 * intenções diferentes: no dry-run (para o operador ver quantos vão ser pulados
 * ANTES de ativar) e no envio (porque entre a ativação e o disparo o contato
 * pode ter mandado "PARAR").
 */
import { MOTIVOS_DE_PULO, type MotivoDePulo } from "./vocabulario";

export interface ContatoParaDisparo {
  id: string;
  phone_number: string | null;
  wa_identity: string | null;
  is_blocked: boolean | null;
  is_anonymized?: boolean | null;
  is_merged_into?: string | null;
}

/**
 * O telefone que o WAHA vai discar bate com a identidade do WhatsApp?
 *
 * Cópia deliberada de `telefoneDivergeDaIdentidade`
 * (app/api/v1/leads/[id]/primeiro-toque/route.ts) — vale a pena repetir 6
 * linhas para não importar uma rota dentro de um worker.
 *
 * `resolveWahaChatId` monta o chat a partir de `phone_number`. Quando a
 * `wa_identity` gravada é `phone:+E164` e os dígitos divergem, a mensagem sai,
 * ganha id, aparece "enviada" no inbox — e NÃO CHEGA. Aconteceu com 20 leads em
 * 21/08/2026, e o sintoma é justamente não ter sintoma. Num disparo de 300
 * destinatários isso seria descoberto tarde demais: o relatório diria "300
 * enviadas" e o telefone não tocaria.
 */
export function telefoneDivergeDaIdentidade(
  phoneNumber: string | null,
  waIdentity: string | null,
): boolean {
  if (!phoneNumber || !waIdentity?.startsWith("phone:+")) return false;
  return waIdentity.slice("phone:".length).replace(/\D/g, "") !== phoneNumber.replace(/\D/g, "");
}

/** `null` = pode mandar. Caso contrário, o motivo do pulo. */
export function motivoParaPular(c: ContatoParaDisparo): MotivoDePulo | null {
  if (c.is_merged_into) return "contato_fundido";
  if (c.is_anonymized) return "anonimizado";
  if (c.is_blocked) return "bloqueado";
  if (!c.phone_number) return "sem_telefone";
  if (telefoneDivergeDaIdentidade(c.phone_number, c.wa_identity)) return "telefone_divergente";
  return null;
}

export function fraseDoMotivo(motivo: MotivoDePulo): string {
  return MOTIVOS_DE_PULO[motivo];
}
