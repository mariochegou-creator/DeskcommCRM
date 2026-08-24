/**
 * O TIME do grupo da reunião — resolvido pelo CADASTRO, não por lista solta.
 *
 * Até 24/08/2026 os convidados saíam de `grupo_da_reuniao.participantes`, uma
 * lista de telefones digitada uma vez e esquecida. Ela apodreceu do jeito
 * clássico: o David trocou de número, o cadastro do CRM acompanhou
 * (Configurações → Perfil → "Meu número de WhatsApp") e a lista não — dois
 * grupos nasceram convidando o número VELHO dele, com `faltaram: []`, porque o
 * WhatsApp adicionou o dono antigo do chip sem reclamar de nada. Grupo errado
 * sem erro nenhum na tela.
 *
 * A regra do Mario (24/08/2026): o grupo é SEMPRE closer + SDR + assistente +
 * lead, e os números do time são OS QUE ESTÃO CADASTRADOS NO CRM. Por isso a
 * fonte daqui é a corrente papel → pessoa → número do Perfil:
 *
 *   `organizations.settings.papeis` (closer/sdr, os MESMOS papéis das tarefas
 *   automáticas) → `auth.users.raw_user_meta_data.meu_numero[org]` (o que a
 *   pessoa escolheu no Perfil) → `channel_sessions.phone_number`.
 *
 * Cada elo dessa corrente é editado numa tela que existe — mudou o número no
 * Perfil, o próximo grupo já nasce certo. E quando um elo FALTA, a resposta é
 * `ok: false` com o nome de quem está pendurado: quem chama NÃO cria o grupo.
 * Grupo incompleto é pior que grupo nenhum — a reunião continua marcada, a
 * confirmação sai no privado (o comportamento de antes do grupo existir) e a
 * tela diz o que consertar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const PAPEIS_DO_GRUPO = ["closer", "sdr"] as const;
type PapelDoGrupo = (typeof PAPEIS_DO_GRUPO)[number];

const ROTULO_DO_PAPEL: Record<PapelDoGrupo, string> = {
  closer: "closer",
  sdr: "SDR",
};

export interface EquipeDaReuniao {
  /** Telefones do time (formato do banco, `+55…`), prontos pro convite. */
  numeros: string[];
  /** Nome do closer — quem os textos do grupo citam ("quem vai conversar com você"). */
  closerNome: string | null;
}

export type ResultadoDaEquipe =
  | { ok: true; equipe: EquipeDaReuniao }
  | {
      /** O que está faltando, em frases prontas pra tela ("David (SDR) sem número no Perfil"). */
      ok: false;
      faltando: string[];
    };

/**
 * Papel → pessoa, com a mesma guarda de `lib/tarefas/criar-da-etapa.ts`: id que
 * não é mais membro vivo da org não vale — configuração velha apontando pra
 * quem saiu não pode pôr número de ex-funcionário em grupo com cliente.
 */
async function pessoasDosPapeis(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ ids: Partial<Record<PapelDoGrupo, string>>; faltando: string[] }> {
  const { data } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();

  const bruto = ((data as { settings?: unknown } | null)?.settings as
    | Record<string, unknown>
    | null)?.["papeis"];
  const papeis =
    bruto && typeof bruto === "object" && !Array.isArray(bruto)
      ? (bruto as Record<string, unknown>)
      : {};

  const faltando: string[] = [];
  const candidatos: Partial<Record<PapelDoGrupo, string>> = {};
  for (const papel of PAPEIS_DO_GRUPO) {
    const id = papeis[papel];
    if (typeof id === "string" && id.length > 0) candidatos[papel] = id;
    else faltando.push(`papel ${ROTULO_DO_PAPEL[papel]} sem pessoa em Configurações`);
  }

  const ids = [...new Set(Object.values(candidatos))];
  if (ids.length > 0) {
    const { data: membros } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", organizationId)
      .in("user_id", ids)
      .is("revoked_at", null);
    const vivos = new Set((membros ?? []).map((m) => m.user_id as string));
    for (const papel of PAPEIS_DO_GRUPO) {
      const id = candidatos[papel];
      if (id && !vivos.has(id)) {
        delete candidatos[papel];
        faltando.push(`o ${ROTULO_DO_PAPEL[papel]} configurado não é mais membro da organização`);
      }
    }
  }

  return { ids: candidatos, faltando };
}

/**
 * O time completo, ou a lista do que falta. NUNCA lança — falha de lookup vira
 * item em `faltando`, porque quem chama está no meio de marcar uma reunião.
 */
export async function equipeDaReuniao(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ResultadoDaEquipe> {
  const { ids, faltando } = await pessoasDosPapeis(admin, organizationId);

  const numeros: string[] = [];
  let closerNome: string | null = null;

  for (const papel of PAPEIS_DO_GRUPO) {
    const userId = ids[papel];
    if (!userId) continue; // já está em `faltando`

    let nome: string | null = null;
    let sessionId: string | null = null;
    try {
      const { data } = await admin.auth.admin.getUserById(userId);
      const meta = data?.user?.user_metadata as
        | { full_name?: string; meu_numero?: Record<string, string> }
        | undefined;
      nome = meta?.full_name ?? null;
      sessionId = meta?.meu_numero?.[organizationId] ?? null;
    } catch {
      // cai no `faltando` abaixo, com o rótulo do papel no lugar do nome
    }

    const quem = nome ?? `o ${ROTULO_DO_PAPEL[papel]}`;
    if (papel === "closer") closerNome = nome;

    if (!sessionId) {
      faltando.push(`${quem} (${ROTULO_DO_PAPEL[papel]}) sem "Meu número de WhatsApp" no Perfil`);
      continue;
    }

    const { data: sessao } = await admin
      .from("channel_sessions")
      .select("phone_number, archived_at")
      .eq("id", sessionId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    const linha = sessao as { phone_number: string | null; archived_at: string | null } | null;

    // Arquivada ou sem telefone = o cadastro aponta pra um número que não
    // existe mais — o Perfil precisa ser reescolhido, não adivinhado aqui.
    if (!linha || linha.archived_at || !linha.phone_number) {
      faltando.push(
        `o número do Perfil de ${quem} (${ROTULO_DO_PAPEL[papel]}) não está mais conectado`,
      );
      continue;
    }

    numeros.push(linha.phone_number);
  }

  if (faltando.length > 0) return { ok: false, faltando };
  return { ok: true, equipe: { numeros, closerNome } };
}

/**
 * Só o nome do closer — pros textos que o citam (abertura, véspera, toque
 * final). Existe separado porque o cron precisa do NOME mesmo quando algum
 * número do time está pendurado: lembrete de reunião já marcada não pode parar
 * por causa de Perfil incompleto.
 */
export async function nomeDoCloser(
  admin: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const { ids } = await pessoasDosPapeis(admin, organizationId);
  const userId = ids.closer;
  if (!userId) return null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return (data?.user?.user_metadata?.full_name as string | undefined) ?? null;
  } catch {
    return null;
  }
}
