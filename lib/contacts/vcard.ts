/**
 * O contato que o cliente MANDA dentro da conversa, lido como nome + telefone.
 *
 * O WhatsApp entrega "compartilhar contato" como vCard (`type` cru `vcard` ou
 * `multi_vcard`, mapeados para `contact` em lib/waha/ingest.ts) e o texto do
 * cartão chega inteiro no `body` da mensagem. Sem este módulo o inbox mostra o
 * cartão como ele veio — sete linhas de `BEGIN:VCARD`, `VERSION:3.0`,
 * `item1.X-ABLabel` — e o número do decisor, que é a única coisa ali que
 * importa, fica no meio de um bloco que ninguém lê.
 *
 * Módulo PURO (sem I/O), porque a bolha da conversa desenha o cartão no
 * navegador e a rota que grava o vínculo confere o mesmo número no servidor:
 * duas leituras do mesmo texto que precisam concordar.
 *
 * O TELEFONE VEM DO `waid`, não do texto do TEL. O WhatsApp escreve o número
 * como a pessoa cadastrou na agenda dela ("73 9 9981-8151", "+55 (73) 99981
 * 8151", "(73) 99981-8151 - loja") e anexa o identificador real no parâmetro
 * `waid=5573999818151`. Ler o texto é o caminho que produz os pares partidos
 * que a migration 0102 passou o dia desfazendo; ler o `waid` é ler a mesma
 * chave que o CRM já usa.
 */
import { telefoneE164 } from "./telefone";

export interface ContatoDoVCard {
  /** `FN` do cartão, ou o nome montado do `N` quando não há `FN`. */
  nome: string | null;
  /** E.164 (`+5573999818151`) quando dá para confiar; `null` quando não dá. */
  telefone: string | null;
  /** O número como o cartão trazia escrito — só para exibição. */
  telefoneCru: string | null;
}

/**
 * Desdobra a continuação de linha do vCard (RFC 6350 §3.2): linha que começa
 * com espaço ou tab é a continuação da anterior. Nomes longos chegam quebrados,
 * e sem isto o sobrenome do decisor virava uma linha solta que não casa com
 * nenhum campo.
 */
function desdobrarLinhas(texto: string): string[] {
  const cruas = texto.split(/\r\n|\r|\n/);
  const linhas: string[] = [];
  for (const crua of cruas) {
    if (/^[ \t]/.test(crua) && linhas.length > 0) {
      linhas[linhas.length - 1] += crua.slice(1);
      continue;
    }
    linhas.push(crua);
  }
  return linhas;
}

/** `item1.TEL;waid=55…` → `{ propriedade: "TEL", parametros: "waid=55…" }`. */
function partirLinha(linha: string): { propriedade: string; parametros: string; valor: string } | null {
  const doisPontos = linha.indexOf(":");
  if (doisPontos < 0) return null;
  const esquerda = linha.slice(0, doisPontos);
  const valor = linha.slice(doisPontos + 1).trim();
  const [nomeCompleto = "", ...parametros] = esquerda.split(";");
  // O prefixo `item1.` é agrupamento do vCard, não parte do nome da propriedade.
  const propriedade = nomeCompleto.split(".").pop()?.trim().toUpperCase() ?? "";
  return { propriedade, parametros: parametros.join(";"), valor };
}

/** `N:;João;Silva;;` → `João Silva`. Os componentes vazios saem. */
function nomeDoCampoN(valor: string): string | null {
  const partes = valor.split(";").map((p) => p.trim()).filter(Boolean);
  if (partes.length === 0) return null;
  // A ordem do `N` é sobrenome;nome;meio;prefixo;sufixo — quem lê espera o nome
  // primeiro, então os dois primeiros componentes trocam de lugar.
  const [sobrenome, nome, ...resto] = partes;
  return [nome, sobrenome, ...resto].filter(Boolean).join(" ");
}

function telefoneDaLinha(parametros: string, valor: string): { e164: string | null; cru: string } {
  const waid = /waid=([0-9]+)/i.exec(parametros)?.[1] ?? null;
  // O `waid` já é o número do WhatsApp em dígitos puros — só falta o `+`.
  // Fallback no texto porque contato de agenda antiga (fixo, número que nunca
  // usou WhatsApp) vem SEM `waid`, e ligar para ele continua valendo.
  const e164 = waid ? telefoneE164(`+${waid}`) : telefoneE164(valor);
  return { e164, cru: valor };
}

/**
 * Lê o texto de uma mensagem de contato e devolve um item por cartão.
 *
 * Devolve lista, não item único: `multi_vcard` existe e é o caso comum quando o
 * cliente manda "o pessoal do financeiro" — dois ou três cartões numa mensagem
 * só. Ficar com o primeiro esconderia os outros sem dizer que existem.
 *
 * Cartão SEM telefone utilizável entra na lista mesmo assim (`telefone: null`):
 * quem desenha a bolha precisa mostrar que veio um contato e explicar por que
 * não dá para adicioná-lo, e uma lista vazia contaria a história errada — a de
 * que a mensagem não tinha nada dentro.
 */
export function analisarVCard(texto: string | null | undefined): ContatoDoVCard[] {
  if (typeof texto !== "string" || !texto.includes("BEGIN:VCARD")) return [];

  const cartoes: ContatoDoVCard[] = [];
  let atual: { fn: string | null; n: string | null; telefone: string | null; cru: string | null } | null = null;

  for (const linha of desdobrarLinhas(texto)) {
    const parte = partirLinha(linha);
    if (!parte) continue;

    if (parte.propriedade === "BEGIN" && parte.valor.toUpperCase() === "VCARD") {
      atual = { fn: null, n: null, telefone: null, cru: null };
      continue;
    }
    if (parte.propriedade === "END" && parte.valor.toUpperCase() === "VCARD") {
      if (atual) {
        cartoes.push({
          nome: atual.fn ?? atual.n,
          telefone: atual.telefone,
          telefoneCru: atual.cru,
        });
      }
      atual = null;
      continue;
    }
    if (!atual) continue;

    if (parte.propriedade === "FN" && parte.valor) atual.fn = parte.valor;
    if (parte.propriedade === "N" && !atual.n) atual.n = nomeDoCampoN(parte.valor);
    if (parte.propriedade === "TEL") {
      const { e164, cru } = telefoneDaLinha(parte.parametros, parte.valor);
      // O PRIMEIRO número utilizável ganha, e um segundo TEL não o substitui:
      // o WhatsApp põe o celular com `waid` na frente e o fixo depois, e é o
      // celular que atende. Mas um TEL sem número aproveitável não pode apagar
      // o que já foi achado — daí as duas guardas separadas.
      if (e164 && !atual.telefone) {
        atual.telefone = e164;
        atual.cru = cru;
      } else if (!atual.cru) {
        atual.cru = cru;
      }
    }
  }

  return cartoes;
}
