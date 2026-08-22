import { LigacoesClient } from "./_components/LigacoesClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ligações" };

/**
 * Ligações — o histórico das ligações do time e a nota de cada uma.
 *
 * POR QUE ESTA TELA NASCEU DEPOIS DA FERRAMENTA. Na entrega original a análise
 * só existia dentro do contato e do dossiê do negócio. Para reler uma ligação
 * era preciso lembrar PARA QUEM ela tinha sido feita — e quem coordena o time
 * não pensa assim: a pergunta é "como foram as ligações de ontem". Sem tela
 * própria, o recurso existia e ninguém achava; a conclusão razoável de quem
 * usava era que ele não funcionava.
 *
 * Aqui a lista é rasa de propósito (quem, quando, quanto tempo, desfecho,
 * nota). O detalhe fica onde já estava: no card da timeline do contato, que é
 * onde a ligação faz sentido junto do resto da conversa.
 */
export default function LigacoesPage() {
  return <LigacoesClient />;
}
