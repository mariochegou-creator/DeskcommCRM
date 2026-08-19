/**
 * Contrato de `POST /api/v1/leads/[id]/meeting` — marcar (ou remarcar) a
 * reunião de um negócio.
 *
 * Data e hora chegam em CIVIL da Bahia, não em ISO UTC: quem preenche é um
 * humano olhando um calendário na tela, e converter no cliente espalharia a
 * aritmética de fuso por duas bases de código. A conversão acontece num lugar
 * só — `lib/meetings/agendamento.ts`.
 */
import { z } from "zod";

export const TIPOS_DE_REUNIAO = ["raio-x", "r1", "r2"] as const;

export const agendarReuniaoSchema = z.strictObject({
  /** YYYY-MM-DD, no fuso da Bahia. */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD"),
  /** HH:MM, 24h, no fuso da Bahia. */
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora deve ser HH:MM"),
  /**
   * Ausente = derivado da etapa em que o card está. O cliente manda quando
   * quer ser explícito; a rota nunca depende disso para funcionar.
   */
  tipo: z.enum(TIPOS_DE_REUNIAO).optional(),
  /** E-mails que recebem o convite do Google Agenda. */
  convidados: z.array(z.string().email()).max(5).optional(),
  /**
   * Criar o grupo do WhatsApp (lead + time) e mandar a confirmação NELE.
   *
   * Ausente = SIM. O padrão é criar porque o grupo é o que derruba o no-show
   * (ver `lib/agendamento/grupo.ts`), e padrão que depende de alguém lembrar de
   * marcar uma caixinha não acontece na correria. `false` explícito mantém o
   * comportamento antigo: confirmação no privado do lead.
   */
  criar_grupo: z.boolean().optional(),
});
export type AgendarReuniaoInput = z.infer<typeof agendarReuniaoSchema>;
