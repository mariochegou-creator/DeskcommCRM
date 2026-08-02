import { redirect } from "next/navigation";

/**
 * `/app` agora cai no Painel, não mais no Inbox.
 *
 * O painel é a tela que o redesign introduz como porta de entrada — é onde
 * estão o valor do funil e a leitura do período. Quem trabalha o dia inteiro na
 * caixa de entrada continua com ela a um clique no rail (e o navegador guarda a
 * última URL), mas a primeira tela do produto passa a ser a que resume o
 * negócio.
 */
export default function AppHome() {
  redirect("/app/dashboard");
}
