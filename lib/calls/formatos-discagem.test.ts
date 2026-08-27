/**
 * O que vai depois de `tel:` — dígito por dígito.
 *
 * Este arquivo existe porque o erro aqui é invisível na tela e caro na rua: o
 * número aparece certo no popup e a chamada não completa. Em 27/08/2026 foram
 * oito ligações perdidas assim, com a gravação da Claro ("não foi possível
 * completar a chamada, verifique o número") entrando na transcrição no lugar da
 * conversa.
 *
 * Os números são reais, da base da Nexo.
 */
import { describe, expect, it } from "vitest";

import { CSP_PADRAO, opcaoEscolhida, opcoesDeDiscagem } from "./formatos-discagem";

/** Bella Ambientes, Lauro de Freitas — o lead da tela que motivou a mudança. */
const BELLA = "+5571996436883";

describe("opcoesDeDiscagem", () => {
  it("devolve os três formatos, o interurbano primeiro", () => {
    const o = opcoesDeDiscagem(BELLA);
    expect(o.map((x) => x.formato)).toEqual(["interurbano", "nacional", "internacional"]);
  });

  it("interurbano: 0 + código da operadora + DDD + número, sem separador nenhum", () => {
    const [interurbano] = opcoesDeDiscagem(BELLA);
    expect(interurbano?.discar).toBe("02171996436883");
    expect(CSP_PADRAO).toBe("21");
  });

  it("nacional: DDD + número, sem o zero e sem o +55", () => {
    const nacional = opcoesDeDiscagem(BELLA)[1];
    expect(nacional?.discar).toBe("71996436883");
  });

  it("internacional: o E.164 intacto — é o que o CRM fazia sozinho", () => {
    const internacional = opcoesDeDiscagem(BELLA)[2];
    expect(internacional?.discar).toBe(BELLA);
  });

  it("fixo de 8 dígitos entra igual — a regra é do formato, não do tipo de linha", () => {
    // Incomaf, Lauro de Freitas: (71) 3289-6300.
    const [interurbano, nacional] = opcoesDeDiscagem("+557132896300");
    expect(interurbano?.discar).toBe("0217132896300");
    expect(nacional?.discar).toBe("7132896300");
  });

  it("o rótulo é o número agrupado, para o SDR reconhecer o que vai discar", () => {
    const o = opcoesDeDiscagem(BELLA);
    expect(o[0]?.rotulo).toBe("0 21 (71) 99643-6883");
    expect(o[1]?.rotulo).toBe("(71) 99643-6883");
    expect(o[2]?.rotulo).toBe("+55 (71) 99643-6883");
  });

  it("outra operadora troca só o código: a Vivo é 15", () => {
    expect(opcoesDeDiscagem(BELLA, "15")[0]?.discar).toBe("01571996436883");
  });

  it("número de fora do Brasil tem UMA opção — 0 21 num +351 seria erro", () => {
    const o = opcoesDeDiscagem("+351912345678");
    expect(o).toHaveLength(1);
    expect(o[0]?.discar).toBe("+351912345678");
  });
});

describe("opcaoEscolhida", () => {
  it("acha o formato guardado", () => {
    const o = opcoesDeDiscagem(BELLA);
    expect(opcaoEscolhida(o, "nacional", BELLA).discar).toBe("71996436883");
  });

  it("sem escolha, cai no primeiro — o interurbano", () => {
    const o = opcoesDeDiscagem(BELLA);
    expect(opcaoEscolhida(o, null, BELLA).formato).toBe("interurbano");
  });

  it("formato que não existe para este número não trava a ligação", () => {
    // Preferência "interurbano" guardada, e o lead agora é estrangeiro.
    const o = opcoesDeDiscagem("+351912345678");
    expect(opcaoEscolhida(o, "interurbano", "+351912345678").discar).toBe("+351912345678");
  });
});
