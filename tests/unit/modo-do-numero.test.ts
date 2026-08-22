import { describe, expect, it } from "vitest";

import { BLOCO_COPILOTO, lerModoDoNumero } from "@/lib/agent-engine/edge/crm/modo-do-numero";

/**
 * O default é a regra inteira desta peça.
 *
 * "Na dúvida, cale" soa mais seguro e é o defeito: uma falha de leitura calaria
 * a IA de TODOS os números, sem nada na tela dizendo por quê, e o dono
 * descobriria pelos leads que ninguém respondeu. Silêncio é o estado que
 * ninguém percebe.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (resposta: unknown): any => ({
  query: async () => {
    if (resposta instanceof Error) throw resposta;
    return { rows: resposta as unknown[] };
  },
});

describe("lerModoDoNumero", () => {
  it("metadata.ai_mode = 'copiloto' liga o modo", async () => {
    expect(await lerModoDoNumero(db([{ modo: "copiloto" }]), "org", "sess")).toBe("copiloto");
  });

  it("sem a chave no metadata, o número atende — como sempre atendeu", async () => {
    expect(await lerModoDoNumero(db([{ modo: null }]), "org", "sess")).toBe("atendente");
  });

  it("número que nem existe na tabela atende", async () => {
    expect(await lerModoDoNumero(db([]), "org", "sess")).toBe("atendente");
  });

  it("valor desconhecido atende — só a palavra exata liga o freio", async () => {
    // Um dia alguém grava "copilot", "COPILOTO" ou "true" achando que basta. O
    // número seguir atendendo é visível no mesmo dia; calar por engano, não.
    for (const v of ["copilot", "COPILOTO", "true", "1", ""]) {
      expect(await lerModoDoNumero(db([{ modo: v }]), "org", "sess")).toBe("atendente");
    }
  });

  it("banco fora NÃO cala a IA", async () => {
    expect(await lerModoDoNumero(db(new Error("connection refused")), "org", "sess")).toBe(
      "atendente",
    );
  });

  it("turno sem número (nulo) atende, e nem consulta o banco", async () => {
    const semQuery = {
      query: () => {
        throw new Error("não deveria consultar");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(await lerModoDoNumero(semQuery, "org", null)).toBe("atendente");
  });
});

describe("BLOCO_COPILOTO", () => {
  it("diz as três coisas que o modelo precisa saber", async () => {
    // Sem a terceira, o modelo redige uma bela resposta que não vai a lugar
    // nenhum — e termina o turno achando que atendeu o cliente.
    expect(BLOCO_COPILOTO).toContain("não tem a ferramenta");
    expect(BLOCO_COPILOTO).toContain("update_lead_state");
    expect(BLOCO_COPILOTO).toContain("Não redija a resposta ao cliente");
  });
});
