/**
 * Interpola variáveis de template com dados do contato da conversa (Onda 5).
 * Variável sem valor ou desconhecida mantém o literal `{{x}}` — nunca gera
 * texto quebrado que iria pro cliente.
 */
export interface TemplateContact {
  name?: string | null;
}

/**
 * A saudação certa para a hora em que o template foi USADO.
 *
 * ⚠️ POR QUE ISTO EXISTE. Sem uma variável de saudação, quem escreve o template
 * digita "bom dia" no texto — e aí o atalho manda "bom dia" às onze da noite. O
 * erro não aparece para quem cadastrou (que cadastrou de manhã), aparece para o
 * cliente, e é o tipo de detalhe que faz uma mensagem parecer disparo de robô,
 * que é exatamente o oposto do que o atalho serve para fazer.
 *
 * As faixas são as do português falado, não as do relógio: a tarde começa ao
 * meio-dia e a noite às 18h. Meia-noite às 4h59 continua "boa noite" — quem
 * manda mensagem a essa hora não diz "bom dia".
 */
export function saudacaoDaHora(agora: Date = new Date()): string {
  const h = agora.getHours();
  if (h >= 5 && h < 12) return "bom dia";
  if (h >= 12 && h < 18) return "boa tarde";
  return "boa noite";
}

export function interpolateTemplate(
  body: string,
  contact: TemplateContact,
  agora: Date = new Date(),
): string {
  const full = (contact.name ?? "").trim();
  const first = full.split(/\s+/)[0] ?? "";
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (literal, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (key === "nome") return full !== "" ? full : literal;
    if (key === "primeiro_nome") return first !== "" ? first : literal;
    // Sempre resolve: saudação não depende de dado do contato, então não há o
    // caso "sem valor" que justificaria manter o literal.
    if (key === "saudacao") return saudacaoDaHora(agora);
    if (key === "saudacao_maiuscula") {
      const s = saudacaoDaHora(agora);
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    return literal; // desconhecida: mantém
  });
}
