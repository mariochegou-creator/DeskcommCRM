import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { contarDemo } from "@/lib/nexo-demo/seed";
import { Botoes } from "./Botoes";

export const dynamic = "force-dynamic";

export default async function DemoNexoPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const contagem = await contarDemo(org.orgId);
  const podeUsar = org.role === "admin" || user.is_platform_admin;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Modo demonstração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preenche o CRM com uma operação fictícia da NEXO IA — funil de vendas consultivas,
          negócios locais em todas as etapas, histórico de atendimento, pontuação de lead com
          justificativa e uma conversa de WhatsApp. Serve para ver como o sistema fica cheio
          antes de decidir se ele serve.
        </p>
      </header>

      {podeUsar ? (
        <div className="max-w-3xl">
          <Botoes inicial={contagem} />
        </div>
      ) : (
        <div className="max-w-3xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          Só o admin da organização pode ligar ou desligar a demonstração. Seu papel atual é{" "}
          <strong>{org.role}</strong>.
        </div>
      )}

      <section className="max-w-3xl rounded-lg border p-5">
        <h2 className="text-sm font-semibold">O que entra</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Funil NEXO IA</strong> — as 9 etapas reais:
            Captação, R1 agendada, R1 feita, APN enviada, R2 agendada, R2 feita, Follow-up,
            Fechado e Perdido
          </li>
          <li>
            <strong className="text-foreground">15 negócios</strong> — pizzaria, barbearia,
            clínica, academia, petshop e outros, espalhados pelas etapas
          </li>
          <li>
            <strong className="text-foreground">Dono humano e dono IA</strong> — alguns cards
            têm o agente como responsável, para ver a diferença visual
          </li>
          <li>
            <strong className="text-foreground">Pontuação justificada</strong> — cada nota vem
            com as parcelas que a formam e um registro do histórico como prova
          </li>
          <li>
            <strong className="text-foreground">Radar de risco</strong> — negócios parados há
            dias, um deles com proposta de reativação pendente
          </li>
          <li>
            <strong className="text-foreground">Uma conversa de WhatsApp</strong> — qualificação
            completa até o convite para a reunião
          </li>
        </ul>
      </section>

      <section className="max-w-3xl rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
        <h2 className="text-sm font-semibold">Antes de usar</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>
            Tudo é ficção. Os telefones usam uma faixa de exemplo e não pertencem a ninguém —
            nenhuma mensagem é enviada.
          </li>
          <li>
            <strong className="text-foreground">Limpar</strong> apaga só o que foi criado aqui.
            O que você cadastrar à mão continua no lugar.
          </li>
          <li>
            <strong className="text-foreground">Preencher de novo</strong> limpa antes de
            semear, então clicar duas vezes não duplica nada.
          </li>
          <li>
            Este é um ambiente de teste. Não ligue a demonstração num banco com dado real de
            cliente.
          </li>
        </ul>
      </section>
    </div>
  );
}
