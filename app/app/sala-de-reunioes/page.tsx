import { SalaDeReunioesClient } from "./_components/SalaDeReunioesClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sala de Reuniões" };

/**
 * Sala de Reuniões — as reuniões do Meet conduzidas com o copiloto SPIN.
 *
 * Diferente do Painel, não há dado a resolver no servidor: a lista vem da API
 * (`/api/v1/meetings`) via React Query, porque a MESMA rota serve a extensão —
 * uma fonte só para as duas superfícies, em vez de um caminho server-side aqui
 * e um REST lá.
 */
export default function SalaDeReunioesPage() {
  return <SalaDeReunioesClient />;
}
