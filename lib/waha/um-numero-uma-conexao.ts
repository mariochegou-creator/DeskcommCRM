/**
 * UM NÚMERO, UMA CONEXÃO — a trava contra o mesmo WhatsApp virar dois cartões.
 *
 * O ESTRAGO QUE ISSO EVITA (medido em 12/08/2026): a org tinha 2 números reais
 * e 4 sessões WAHA vivas — cada WhatsApp escaneado duas vezes, porque quando o
 * número caía ele era religado pelo botão "+ Conectar novo WhatsApp" em vez do
 * "Reconectar" do próprio cartão. Como conversa é única por
 * (org, contato, conexão), cada sessão criou a SUA conversa com o mesmo lead:
 * 75 contatos com a conversa partida em dois lugares. O lead responde e cai
 * numa metade; o SDR abre pelo card e cai na outra.
 *
 * QUANDO ISTO RODA: no health check do canal, que a Central e a tela do QR
 * chamam a cada 3 segundos. É o primeiro momento em que o número existe — o
 * WAHA só revela o `me.id` depois do QR escaneado. Ou seja, a correção acontece
 * segundos depois do escaneamento, quando a conexão repetida ainda não recebeu
 * mensagem nenhuma.
 *
 * A REGRA, uma só: o número tem UM cartão, o mais antigo (mesma doutrina de
 * desempate da migration 0027). O que muda é o destino da sessão que acabou de
 * conectar:
 *
 *   - cartão de sempre ainda de pé no WAHA → é conexão repetida de verdade:
 *     a sessão nova é desconectada do celular e o pouco que ela tenha entra no
 *     cartão (`fn_merge_channel_session`).
 *   - cartão de sempre caído → é religamento: o cartão ASSUME a sessão que
 *     acabou de conectar (`fn_adotar_conexao`) e volta a trabalhar com o
 *     histórico, o rótulo e o agente que sempre teve.
 *
 * Abaixo disso ainda existe a trava do banco (índice único
 * `channel_sessions_numero_vivo_unique`, migration 0104): dois cartões vivos
 * com o mesmo número são impossíveis mesmo que este código não rode.
 */
import "server-only";

import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WahaClient } from "@/lib/waha/client";

export type UniaoDeNumero = {
  /** `repetida_removida`: a conexão a mais saiu. `cartao_reassumiu`: o cartão antigo voltou. */
  acao: "repetida_removida" | "cartao_reassumiu";
  cartao_id: string;
  rotulo: string;
  /** true quando a linha que estava sendo checada deixou de ser o cartão do número. */
  este_cartao_saiu: boolean;
  conversas_juntadas: number;
};

type Linha = {
  id: string;
  waha_session_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  created_at: string;
};

const COLUNAS = "id, waha_session_name, display_name, phone_number, status, created_at";

function rotuloDe(l: Linha): string {
  return l.display_name || l.phone_number || l.waha_session_name;
}

/** O WAHA é a fonte de verdade: `status` no banco pode estar velho. */
async function estaDePe(waha: WahaClient | null, l: Linha): Promise<boolean> {
  if (!waha) return l.status === "WORKING";
  try {
    const r = await waha.getSessionQr(l.waha_session_name);
    return r.status === "WORKING";
  } catch {
    return false;
  }
}

/**
 * Nomes de sessão que estão logadas NESTE número, perguntando ao WAHA.
 *
 * Por que não basta olhar a coluna `phone_number`: a segunda sessão do mesmo
 * WhatsApp fica com a coluna VAZIA (a unique não deixa repetir) — justamente a
 * linha que precisamos achar. O `me.id` do WAHA não tem esse buraco.
 */
async function sessoesLogadasNoNumero(
  waha: WahaClient | null,
  numero: string,
): Promise<Set<string>> {
  if (!waha) return new Set();
  try {
    const todas = await waha.listSessions();
    return new Set(
      todas
        .filter((s) => (s.me?.id ?? "").replace(/\D/g, "") === numero)
        .map((s) => s.name),
    );
  } catch (err) {
    logger.warn("[um-numero] WAHA não listou as sessões", {
      erro: err instanceof Error ? err.message : "desconhecido",
    });
    return new Set();
  }
}

export async function garantirUmCartaoPorNumero(params: {
  orgId: string;
  sessionId: string;
  /** Número vivo lido do WAHA (`me.id` sem o `@c.us`). */
  numero: string;
  waha: WahaClient | null;
}): Promise<UniaoDeNumero | null> {
  const { orgId, sessionId, waha } = params;
  const numero = params.numero.replace(/\D/g, "");
  if (!numero) return null;

  const admin = createAdminClient();

  // Só cartões VIVOS entram na conta. Número removido de propósito perde o
  // telefone no arquivamento e não volta sozinho — remover é uma decisão.
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    logger.warn("[um-numero] não deu para conferir os cartões do número", {
      erro: error.message,
      sessionId,
    });
    return null;
  }

  const vivos = (data ?? []) as Linha[];
  const atual = vivos.find((l) => l.id === sessionId);
  if (!atual) return null;
  // Um cartão só na org: não há o que repetir. É o caminho normal.
  if (vivos.length < 2) return null;

  // Quem mais é este mesmo número? Duas provas, porque uma sozinha tem buraco:
  // a coluna (que fica vazia na segunda sessão) e o WAHA (que sabe o `me.id` de
  // todas). A segunda é o que permite desfazer a bagunça que já existe.
  const irmas = new Map<string, Linha>([[atual.id, atual]]);
  for (const l of vivos) {
    if (l.phone_number && l.phone_number.replace(/\D/g, "") === numero) irmas.set(l.id, l);
  }
  if (irmas.size < vivos.length) {
    const logadas = await sessoesLogadasNoNumero(waha, numero);
    for (const l of vivos) {
      if (logadas.has(l.waha_session_name)) irmas.set(l.id, l);
    }
  }
  const linhas = [...irmas.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (linhas.length < 2) return null;

  const cartao = linhas[0]; // o mais antigo vence
  if (!cartao) return null;

  const desconectarEJuntar = async (repetida: Linha, destino: Linha): Promise<number> => {
    // A ORDEM IMPORTA: primeiro solta o aparelho no celular, depois junta o
    // histórico. Enquanto a sessão repetida estiver de pé ela continua
    // recebendo — e mensagem que chega em canal arquivado é DESCARTADA.
    if (waha) {
      try {
        await waha.deleteSession(repetida.waha_session_name);
      } catch (err) {
        logger.warn("[um-numero] WAHA não soltou a sessão repetida", {
          sessao: repetida.waha_session_name,
          erro: err instanceof Error ? err.message : "desconhecido",
        });
      }
    }
    const { data: res, error: erroMerge } = await admin.rpc("fn_merge_channel_session", {
      p_org: orgId,
      p_from: repetida.id,
      p_into: destino.id,
    });
    if (erroMerge) {
      logger.error("[um-numero] merge falhou", {
        erro: erroMerge.message,
        de: repetida.id,
        para: destino.id,
      });
      return 0;
    }
    const r = (res ?? {}) as { conversas_fundidas?: number; conversas_movidas?: number };
    return (r.conversas_fundidas ?? 0) + (r.conversas_movidas ?? 0);
  };

  // Caso 1 — a linha checada É o cartão de sempre: as outras são as repetidas.
  if (cartao.id === atual.id) {
    let juntadas = 0;
    for (const repetida of linhas.slice(1)) {
      juntadas += await desconectarEJuntar(repetida, cartao);
    }
    logger.warn("[um-numero] conexão repetida removida", {
      numero,
      cartao: cartao.id,
      repetidas: linhas.length - 1,
    });
    return {
      acao: "repetida_removida",
      cartao_id: cartao.id,
      rotulo: rotuloDe(cartao),
      este_cartao_saiu: false,
      conversas_juntadas: juntadas,
    };
  }

  // Caso 2 — o cartão de sempre é outro e continua de pé: esta é a repetida.
  if (await estaDePe(waha, cartao)) {
    const juntadas = await desconectarEJuntar(atual, cartao);
    logger.warn("[um-numero] escaneamento repetido do mesmo WhatsApp", {
      numero,
      cartao: cartao.id,
      recusada: atual.id,
    });
    return {
      acao: "repetida_removida",
      cartao_id: cartao.id,
      rotulo: rotuloDe(cartao),
      este_cartao_saiu: true,
      conversas_juntadas: juntadas,
    };
  }

  // Caso 3 — o cartão caiu e o número foi religado pelo "+": ele assume a
  // sessão nova em vez de nascer um cartão paralelo.
  const { data: res, error: erroAdocao } = await admin.rpc("fn_adotar_conexao", {
    p_org: orgId,
    p_cartao: cartao.id,
    p_nova: atual.id,
    p_numero: numero,
  });
  if (erroAdocao) {
    logger.error("[um-numero] o cartão não conseguiu reassumir a conexão", {
      erro: erroAdocao.message,
      cartao: cartao.id,
      nova: atual.id,
    });
    return null;
  }
  const r = (res ?? {}) as { conversas_fundidas?: number; conversas_movidas?: number };
  logger.warn("[um-numero] cartão reassumiu a conexão do próprio número", {
    numero,
    cartao: cartao.id,
    nova: atual.id,
  });
  return {
    acao: "cartao_reassumiu",
    cartao_id: cartao.id,
    rotulo: rotuloDe(cartao),
    este_cartao_saiu: true,
    conversas_juntadas: (r.conversas_fundidas ?? 0) + (r.conversas_movidas ?? 0),
  };
}
