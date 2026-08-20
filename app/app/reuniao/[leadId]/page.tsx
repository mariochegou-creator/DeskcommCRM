/**
 * /app/reuniao/[leadId] — o roteiro completo da próxima reunião deste lead.
 *
 * É o destino do link que o closer recebe no WhatsApp uma hora antes, depois
 * de responder "sim" ao aviso. O WhatsApp leva o essencial (quem é, dor,
 * gancho, cinco perguntas); esta página leva o SPIN inteiro.
 *
 * PÁGINA PRÓPRIA, e não uma aba da Sala de Reuniões, por causa de onde ela é
 * lida: um celular, em pé, com a call começando. Uma tela, um assunto, zero
 * navegação — abrir a Sala e caçar a reunião certa na lista custaria os dois
 * minutos que ela existe para poupar.
 *
 * Server component: o roteiro já está gravado em `custom_fields.reuniao`, não
 * há nada a buscar do cliente nem estado a manter.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { loadAuthUser } from "@/lib/auth/server";
import { formatarReuniao, lerReuniao, ROTULO_DO_TIPO } from "@/lib/agendamento/reuniao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Roteiro da reunião" };

interface Props {
  params: Promise<{ leadId: string }>;
}

export default async function RoteiroDaReuniaoPage({ params }: Props) {
  const { leadId } = await params;

  const user = await loadAuthUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_leads")
    .select("id, organization_id, title, custom_fields, contacts:contact_id(name, display_name)")
    .eq("id", leadId)
    .maybeSingle();

  const lead = data as {
    id: string;
    organization_id: string;
    title: string | null;
    custom_fields: unknown;
    contacts: { name: string | null; display_name: string | null } | null;
  } | null;
  if (!lead) notFound();

  // A checagem é por PERTENCIMENTO, não pela org ativa do cookie. Quem tem
  // duas empresas abre o link com a errada selecionada mais vezes do que
  // parece — e ver "não encontrado" no próprio lead, minutos antes da call, é
  // o pior momento possível para descobrir isso.
  const podeVer = user.organizations.some((o) => o.organization_id === lead.organization_id);
  if (!podeVer) notFound();

  const reuniao = lerReuniao(lead.custom_fields);
  const roteiro = reuniao?.roteiro ?? null;
  const contato = Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts;
  const nomeDoContato = contato?.display_name ?? contato?.name ?? null;

  if (!reuniao) {
    return (
      <Vazio
        titulo="Este lead não tem reunião marcada."
        detalhe="Marque a reunião no funil para o material ser preparado."
      />
    );
  }

  const q = formatarReuniao(new Date(reuniao.em));

  if (!roteiro) {
    return (
      <Vazio
        titulo="O material ainda não foi preparado."
        detalhe={`A ${ROTULO_DO_TIPO[reuniao.tipo]} é ${q.diaDaSemana}, ${q.diaMes}, às ${q.hora}. Uma hora antes eu pergunto no WhatsApp se preparo.`}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {ROTULO_DO_TIPO[reuniao.tipo]} · {q.diaDaSemana}, {q.diaMes}, às {q.hora}
        </p>
        <h1 className="text-2xl font-semibold">{lead.title?.trim() || "(card sem nome)"}</h1>
        {nomeDoContato ? <p className="text-sm text-muted-foreground">Com {nomeDoContato}</p> : null}
      </header>

      {roteiro.reserva ? (
        <Card className="bg-warning-bg p-4 text-sm text-warning-fg">
          Material montado direto do card — a IA não respondeu na hora. Confirme tudo na conversa
          antes de afirmar qualquer coisa.
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <Campo rotulo="Quem é" valor={roteiro.resumo} />
        <Campo rotulo="Dor provável" valor={roteiro.dor} />
        <Campo rotulo="Abre por" valor={roteiro.gancho} />
        {roteiro.atencao ? <Campo rotulo="Atenção" valor={roteiro.atencao} /> : null}
      </Card>

      <Bloco titulo="As 5 que não podem faltar" perguntas={roteiro.perguntas} numerada />
      <Bloco titulo="Situação" perguntas={roteiro.situacao} />
      <Bloco titulo="Problema" perguntas={roteiro.problema} />
      <Bloco titulo="Implicação" perguntas={roteiro.implicacao} />
      <Bloco titulo="Necessidade" perguntas={roteiro.necessidade} />

      {roteiro.proximo_passo ? (
        <Card className="flex flex-col gap-3 p-4">
          <Campo rotulo="Próximo passo" valor={roteiro.proximo_passo} />
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3 pb-8 text-sm">
        <Link className="text-accent underline" href={`/app/leads/${lead.id}`}>
          Ver o negócio
        </Link>
        <Link className="text-accent underline" href="/app/sala-de-reunioes">
          Sala de Reuniões
        </Link>
      </div>
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  if (!valor.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      <span className="text-sm">{valor}</span>
    </div>
  );
}

function Bloco({
  titulo,
  perguntas,
  numerada = false,
}: {
  titulo: string;
  perguntas: string[];
  numerada?: boolean;
}) {
  if (perguntas.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <ol className="flex flex-col gap-2">
        {perguntas.map((pergunta, i) => (
          <li key={`${titulo}-${i}`} className="flex gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">{numerada ? `${i + 1}.` : "·"}</span>
            <span>{pergunta}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Vazio({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-sm text-muted-foreground">{detalhe}</p>
        <Link className="text-sm text-accent underline" href="/app/sala-de-reunioes">
          Ir para a Sala de Reuniões
        </Link>
      </Card>
    </div>
  );
}
