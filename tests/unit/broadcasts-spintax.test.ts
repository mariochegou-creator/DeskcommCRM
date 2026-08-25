/**
 * O spintax do disparador (0108).
 *
 * O teste que importa é o último bloco: um texto FIXO tem de ser reprovado pelo
 * mesmo critério que o gate anti-ban usa (Jaccard ≥ 0,8). Se esta suíte passar
 * a aceitar texto fixo, o disparo volta a pausar sozinho no terceiro
 * destinatário — que é o defeito que a tela de revisão existe para evitar.
 */
import { describe, expect, it } from "vitest";

import {
  amostraDeVariantes,
  contarVariantes,
  expandirSpintax,
  primeiroNome,
} from "@/lib/broadcasts/spintax";
import { simularSpinning } from "@/lib/broadcasts/simulacao";

describe("primeiroNome", () => {
  it("pega só o primeiro nome", () => {
    expect(primeiroNome("José Carlos da Silva")).toBe("José");
  });

  it("devolve null para vazio", () => {
    expect(primeiroNome("")).toBeNull();
    expect(primeiroNome(null)).toBeNull();
    expect(primeiroNome(undefined)).toBeNull();
  });

  it("mantém o nome inteiro quando a primeira palavra é uma inicial", () => {
    // "J. Carlos" — cortar em "J." deixaria a mensagem começando com uma letra.
    expect(primeiroNome("J. Carlos")).toBe("J. Carlos");
  });
});

describe("expandirSpintax", () => {
  it("substitui a variável antes de sortear", () => {
    // Nome com pipe existe em cadastro importado: se a alternância rodasse
    // primeiro, "Maria | Loja" viraria um sorteio entre "Maria" e "Loja".
    const out = expandirSpintax("Oi {{nome}}, tudo bem?", { nome: "Maria | Loja" });
    expect(out).toBe("Oi Maria | Loja, tudo bem?");
  });

  it("sorteia entre as opções", () => {
    const primeiro = expandirSpintax("{oi|opa|e aí} tudo bem", {}, () => 0);
    const ultimo = expandirSpintax("{oi|opa|e aí} tudo bem", {}, () => 0.99);
    expect(primeiro).toBe("oi tudo bem");
    expect(ultimo).toBe("e aí tudo bem");
  });

  it("usa fallback quando a variável está vazia — nunca vaza {{nome}}", () => {
    const out = expandirSpintax("Oi {{nome}}, vi seu negócio", { nome: null });
    expect(out).not.toContain("{{");
    expect(out).toBe("Oi tudo bem, vi seu negócio");
  });

  it("apaga variável desconhecida em vez de mandar o cru para o lead", () => {
    const out = expandirSpintax("Seu CNPJ {{cnpj}} está ok", {});
    expect(out).not.toContain("{{cnpj}}");
  });

  it("colapsa o espaço duplo que a opção vazia deixa", () => {
    expect(expandirSpintax("oi {amigo|} tudo bem", {}, () => 0.99)).toBe("oi tudo bem");
  });
});

describe("contarVariantes", () => {
  it("multiplica as opções", () => {
    expect(contarVariantes("{a|b} e {c|d|e}")).toBe(6);
  });

  it("texto fixo tem uma variante só", () => {
    expect(contarVariantes("oi, tudo bem?")).toBe(1);
  });

  it("não conta a variável como variação", () => {
    // {{nome}} muda por destinatário mas NÃO engana o gate: trocar uma palavra
    // num texto de 10 deixa o Jaccard em ~0,95.
    expect(contarVariantes("Oi {{nome}}, tudo bem?")).toBe(1);
  });
});

describe("amostraDeVariantes", () => {
  it("é determinística — a mesma tela mostra os mesmos exemplos", () => {
    const a = amostraDeVariantes("{oi|opa|e aí} {{nome}}", { nome: "Ana" }, 3);
    const b = amostraDeVariantes("{oi|opa|e aí} {{nome}}", { nome: "Ana" }, 3);
    expect(a).toEqual(b);
  });

  it("devolve variantes distintas", () => {
    const amostra = amostraDeVariantes("{oi|opa|e aí|bom dia} tudo bem", {}, 3);
    expect(new Set(amostra).size).toBe(amostra.length);
  });
});

describe("simularSpinning — o portão do anti-ban, com o motor de verdade", () => {
  it("texto FIXO é vetado no 3º envio", () => {
    // repetitionThreshold=2: duas cópias iguais na janela e a terceira é vetada.
    const sim = simularSpinning("Oi, vi que você tem uma loja aqui na cidade e queria falar");
    expect(sim.vetaria).toBe(true);
    expect(sim.envioDoVeto).toBe(3);
  });

  it("trocar só o nome NÃO salva do gate", () => {
    // A armadilha: parece personalizado e não é. A simulação varia o nome por
    // envio, como a produção — e mesmo assim uma palavra diferente em vinte
    // deixa o Jaccard perto de 1.
    const sim = simularSpinning(
      "Oi {{nome}}, vi que você tem uma loja aqui na cidade e queria te mostrar uma coisa rápida",
    );
    expect(sim.vetaria).toBe(true);
    expect(sim.envioDoVeto).toBe(3);
  });

  it("para 2 destinatários até texto fixo passa", () => {
    // O gate veta a partir da 3ª quase-idêntica; com público de 2 ela não existe.
    const sim = simularSpinning("Oi, vi que você tem uma loja aqui na cidade e queria falar", {
      envios: 2,
    });
    expect(sim.vetaria).toBe(false);
  });

  it("spin de verdade passa a janela inteira", () => {
    const sim = simularSpinning(
      "{Oi|Bom dia|Olá} {{nome}}! {Vi seu perfil e achei bacana|Passei no seu Instagram agora|Dei uma olhada no que vocês fazem}. " +
        "{Posso te mandar uma ideia rápida|Queria te mostrar uma coisa|Tenho uma sugestão pra te dar}?",
    );
    expect(sim.vetaria).toBe(false);
    expect(sim.envioDoVeto).toBeNull();
  });
});
