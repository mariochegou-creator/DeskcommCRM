/**
 * Plano de 60 dias (NEXO IA) — semeia as tarefas PONTUAIS em `plan_tasks` e,
 * opcionalmente, liga o resumo bom-dia (organizations.settings.sixty_day_brief).
 *
 *   npx tsx scripts/seed-plano-60-dias.ts --org <uuid>
 *   npx tsx scripts/seed-plano-60-dias.ts --org <uuid> --dry-run
 *   npx tsx scripts/seed-plano-60-dias.ts --org <uuid> \
 *     --resumo "Mario=+5577999999999,David=+5577888888888" [--sessao <waha_session_name>]
 *
 * É AQUI que o Claude adiciona tarefa nova nas sessões seguintes: append em
 * TAREFAS com slug novo, deploy, e rodar de novo. O upsert é idempotente pela
 * constraint (organization_id, plan_key, slug) e o payload NÃO carrega
 * status/resolved_* — re-rodar atualiza título/dono/prazo/ordem e NUNCA reseta
 * o que o Mario já marcou na tela.
 *
 * Remoção é deliberadamente manual: tarefa que saiu do array NÃO é apagada —
 * apagar registro marcado como feito destruiria histórico; o caminho é "Pular"
 * na tela. Rotina diária e checkpoints não entram aqui (constantes em
 * lib/plan/sixty-day-plan.ts — ver o porquê no cabeçalho da migration 0094).
 *
 * ⚠️ ORDEM: publicar o código PRIMEIRO, seed DEPOIS — o banco é o MESMO do
 * localhost e da produção (docs/deploy-nexo/PUBLICAR.md).
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import { PLAN_OWNERS, SIXTY_DAY_PLAN, type PlanOwner } from "../lib/plan/sixty-day-plan";

interface TarefaSeed {
  /** Chave de idempotência dentro do plano — nunca renomear depois de semeado. */
  slug: string;
  title: string;
  description?: string;
  phase: 0 | 1 | 2 | 3;
  owner: PlanOwner;
  /** Dia civil America/Bahia (YYYY-MM-DD). Sem data = "quando der, nesta fase". */
  due?: string;
  position: number;
}

const TAREFAS: TarefaSeed[] = [
  {
    slug: "f0-conferir-22-bios",
    title: "Conferir as 22 bios de Instagram e anotar o WhatsApp",
    description:
      "Abrir prospeccao/lem-barreiras-0608/saida/00-bios-pra-conferir.md, clicar em cada link e anotar o WhatsApp da bio (ou marcar que não tem). Destrava a importação dos 22 leads que hoje só têm o fixo do balcão.",
    phase: 0,
    owner: "mario",
    due: "2026-08-09",
    position: 10,
  },
  {
    slug: "f0-criar-funil-8-etapas",
    title: "Criar o funil de prospecção com as 8 etapas no CRM",
    description:
      "Entrada → Em cadência → Respondeu → Raio-x marcado → R1 feita → Proposta (R2) → Fechado (ganho) → Perdido. O nome do funil deve conter 'Prospecção' para o Painel detectá-lo.",
    phase: 0,
    owner: "mario",
    due: "2026-08-09",
    position: 20,
  },
  {
    slug: "f0-importar-leads-novos",
    title: "Importar os 53 leads prontos + os 22 das bios no funil",
    description:
      "prospeccao/lem-barreiras-0608/saida/pipeline-import.csv já está pronto; os 22 das bios entram assim que o Mario conferir. Depende do funil de 8 etapas existir.",
    phase: 0,
    owner: "claude",
    due: "2026-08-09",
    position: 30,
  },
  {
    slug: "f0-publicar-agente-cadencia",
    title: "Publicar versão do agente com a cadência anti-vácuo ligada",
    description:
      "Os agentes da org estão sem versão publicada; sem isso a cadência D2/D5/D9/D14 existe mas não enrolla ninguém (gate do resolveAgentForAutomaticTrigger).",
    phase: 0,
    owner: "claude",
    due: "2026-08-09",
    position: 40,
  },
  {
    slug: "f0-oferta-fundadora",
    title: "Escrever a Oferta Fundadora em 1 página e decorar",
    description:
      "Preço de fundador (nunca grátis) + garantia agressiva + depoimento e case garantidos em contrato. Uma oferta só — sem inventar pacote na hora da call.",
    phase: 0,
    owner: "dupla",
    due: "2026-08-10",
    position: 50,
  },
  {
    slug: "f0-script-ligacao-30s",
    title: "Escrever o script de ligação de 30 segundos",
    description:
      "Abertura + gancho do raio-x + resposta pras 3 objeções mais comuns. Mario e David treinam em voz alta antes de segunda.",
    phase: 0,
    owner: "claude",
    due: "2026-08-10",
    position: 60,
  },
  {
    slug: "f1-engordar-lista-poco",
    title: "Engordar a lista de POÇO nas 3 cidades vizinhas",
    description:
      "Rodar as consultas de prospeccao/nichos-novos-0826/poco-irrigacao/consultas.txt em São Desidério, Riachão das Neves e Formosa do Rio Preto — POÇO entrou no teste com só 12 leads (meta era 40).",
    phase: 1,
    owner: "claude",
    position: 10,
  },
];

// ---------------------------------------------------------------------------

const tarefaSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
  title: z.string().min(3).max(140),
  description: z.string().max(600).optional(),
  phase: z.number().int().min(0).max(3),
  owner: z.enum(PLAN_OWNERS),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .refine(
      (d) => d === undefined || (d >= SIXTY_DAY_PLAN.phases[0]!.from && d <= SIXTY_DAY_PLAN.endDate),
      { message: `due fora da janela do plano (${SIXTY_DAY_PLAN.phases[0]!.from}..${SIXTY_DAY_PLAN.endDate})` },
    ),
  position: z.number().int().min(0),
});

const resumoSchema = z
  .array(z.object({ name: z.string().min(1).max(40), phone: z.string().regex(/^\+\d{8,15}$/) }))
  .min(1)
  .max(5);

function argOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

function validarTarefas(): void {
  const slugs = new Set<string>();
  for (const t of TAREFAS) {
    const parsed = tarefaSchema.safeParse(t);
    if (!parsed.success) {
      throw new Error(`tarefa "${t.slug}": ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    if (slugs.has(t.slug)) throw new Error(`slug duplicado no seed: "${t.slug}"`);
    slugs.add(t.slug);
  }
}

function parseResumo(raw: string): Array<{ name: string; phone: string }> {
  const recipients = raw.split(",").map((pair) => {
    const [name, phone] = pair.split("=").map((s) => s.trim());
    return { name: name ?? "", phone: phone ?? "" };
  });
  const parsed = resumoSchema.safeParse(recipients);
  if (!parsed.success) {
    throw new Error(
      `--resumo inválido (esperado "Nome=+55DDDNUMERO,..."): ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function lerEnvLocal(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env.local");
  const envFile = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};
  for (const line of envFile.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }
  return env;
}

async function main(): Promise<void> {
  // O dry-run valida a ESTRUTURA antes de tocar env ou banco — funciona numa
  // máquina sem .env.local nenhum.
  validarTarefas();

  if (process.argv.includes("--dry-run")) {
    console.log(`dry-run: ${TAREFAS.length} tarefas válidas para o plano "${SIXTY_DAY_PLAN.key}".`);
    for (const t of TAREFAS) {
      console.log(
        `  F${t.phase} · ${t.slug} · ${t.owner}${t.due ? ` · até ${t.due}` : ""} — ${t.title}`,
      );
    }
    const resumoRaw = argOf("--resumo");
    if (resumoRaw) {
      const recipients = parseResumo(resumoRaw);
      console.log(`dry-run: resumo bom-dia para ${recipients.map((r) => r.name).join(" e ")}.`);
    }
    console.log("dry-run: nada foi escrito.");
    return;
  }

  const orgId = argOf("--org");
  if (!orgId) {
    console.error("uso: npx tsx scripts/seed-plano-60-dias.ts --org <uuid> [--dry-run]");
    console.error('     [--resumo "Mario=+55...,David=+55..."] [--sessao <waha_session_name>]');
    process.exit(1);
  }

  const env = lerEnvLocal();
  const url = env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRole = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRole) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env.local");
  }
  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, display_name, settings")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) throw new Error(`busca da organização: ${orgErr.message}`);
  if (!org) throw new Error(`organização ${orgId} não existe neste banco`);
  console.log(`Organização: ${(org as { display_name: string | null }).display_name ?? orgId} (${orgId})`);

  // Quais slugs já existem — só para o log dizer a verdade (+ criado / ~ atualizado).
  const { data: existentes, error: exErr } = await admin
    .from("plan_tasks")
    .select("slug")
    .eq("organization_id", orgId)
    .eq("plan_key", SIXTY_DAY_PLAN.key);
  if (exErr) throw new Error(`leitura de plan_tasks: ${exErr.message}`);
  const jaExistem = new Set(((existentes ?? []) as Array<{ slug: string }>).map((r) => r.slug));

  console.log("Tarefas:");
  // Payload SEM status/resolved_*: o upsert atualiza só o que está aqui — o
  // que o Mario marcou na tela sobrevive a qualquer re-seed.
  const rows = TAREFAS.map((t) => ({
    organization_id: orgId,
    plan_key: SIXTY_DAY_PLAN.key,
    slug: t.slug,
    title: t.title,
    description: t.description ?? null,
    phase: t.phase,
    owner: t.owner,
    due_date: t.due ?? null,
    position: t.position,
  }));
  const { error: upsertErr } = await admin
    .from("plan_tasks")
    .upsert(rows, { onConflict: "organization_id,plan_key,slug" });
  if (upsertErr) throw new Error(`upsert de plan_tasks: ${upsertErr.message}`);
  for (const t of TAREFAS) {
    console.log(`  ${jaExistem.has(t.slug) ? "~" : "+"} ${t.slug} — ${t.title}`);
  }

  const resumoRaw = argOf("--resumo");
  if (resumoRaw) {
    const recipients = parseResumo(resumoRaw);
    const sessao = argOf("--sessao");
    const settings = ((org as { settings: unknown }).settings ?? {}) as Record<string, unknown>;
    const atual = (settings["sixty_day_brief"] ?? {}) as Record<string, unknown>;
    const novo = {
      enabled: true,
      session_name: sessao ?? (atual["session_name"] as string | null | undefined) ?? null,
      recipients,
    };
    const { error: setErr } = await admin
      .from("organizations")
      .update({ settings: { ...settings, sixty_day_brief: novo } })
      .eq("id", orgId);
    if (setErr) throw new Error(`gravação do sixty_day_brief: ${setErr.message}`);
    console.log(
      `  ✓ resumo bom-dia LIGADO para ${recipients.map((r) => `${r.name} (${r.phone})`).join(" e ")}${novo.session_name ? ` · sessão ${novo.session_name}` : " · sessão automática (1ª WORKING)"}`,
    );
  }

  console.log("");
  console.log("Próximos passos humanos:");
  console.log("  1. Abrir o Painel e conferir a seção \"// plano 60 dias\".");
  console.log("  2. Se o resumo não foi ligado ainda: re-rodar com --resumo \"Mario=+55...,David=+55...\".");
  console.log("  3. Disparar um teste do bom-dia: curl -H \"Authorization: Bearer $INTERNAL_SECRET\" https://crm.nexoialocal.com.br/api/v1/cron/plan-morning-brief");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
