/**
 * Onde o robô fica na tela, e onde o painel abre a partir dele.
 *
 * Existe separado do componente porque é a única parte da "bolinha solta" que dá
 * para errar em silêncio: robô arrastado para fora da janela some e não tem como
 * voltar, e painel ancorado sem dobra abre metade fora da tela. As duas coisas
 * são conta, e conta se testa.
 */

export interface Ponto {
  x: number;
  y: number;
}

export const TAMANHO_DO_ROBO = 48;
/** Respiro mínimo até a borda — abaixo disso o botão encosta e fica feio de pegar. */
export const MARGEM = 12;
/** Faixa da barra inferior do celular. O robô nasce acima dela, nunca em cima. */
export const BARRA_DO_CELULAR = 76;

/**
 * O canto de baixo à direita, que é onde a mão do polegar chega e onde todo
 * mundo espera achar esse tipo de botão. No celular ele sobe o suficiente para
 * não cobrir a navegação.
 */
export function posicaoPadrao(vw: number, vh: number, ehCelular: boolean): Ponto {
  return {
    x: vw - TAMANHO_DO_ROBO - 16,
    y: vh - TAMANHO_DO_ROBO - (ehCelular ? BARRA_DO_CELULAR : 24),
  };
}

/**
 * Segura o robô dentro da janela.
 *
 * ⚠️ Roda também no redimensionamento, e não só no arrastar: quem larga o robô
 * na direita e depois estreita a janela perderia o botão sem esta linha. Perder
 * o botão é irrecuperável pelo próprio botão — só limpando o armazenamento.
 */
export function grudarNaTela(p: Ponto, vw: number, vh: number): Ponto {
  const maxX = Math.max(MARGEM, vw - TAMANHO_DO_ROBO - MARGEM);
  const maxY = Math.max(MARGEM, vh - TAMANHO_DO_ROBO - MARGEM);
  return {
    x: Math.min(Math.max(p.x, MARGEM), maxX),
    y: Math.min(Math.max(p.y, MARGEM), maxY),
  };
}

/**
 * De que lado o painel abre. Ele nasce colado ao robô e dobra para o lado que
 * tem espaço — robô arrastado para a esquerda abre painel à direita, robô no
 * topo abre painel para baixo.
 */
export function ancoraDoPainel(
  robo: Ponto,
  vw: number,
  vh: number,
  largura: number,
  altura: number,
): { left: number; top: number } {
  const centroX = robo.x + TAMANHO_DO_ROBO / 2;
  const centroY = robo.y + TAMANHO_DO_ROBO / 2;

  // Alinha pela borda do robô que está mais longe da parede.
  const left = centroX > vw / 2 ? robo.x + TAMANHO_DO_ROBO - largura : robo.x;
  const top = centroY > vh / 2 ? robo.y - altura - 10 : robo.y + TAMANHO_DO_ROBO + 10;

  return {
    left: Math.min(Math.max(left, MARGEM), Math.max(MARGEM, vw - largura - MARGEM)),
    top: Math.min(Math.max(top, MARGEM), Math.max(MARGEM, vh - altura - MARGEM)),
  };
}

/**
 * Arrastou ou clicou? Abaixo de 5px é clique — dedo em tela sensível nunca fica
 * parado de verdade, e sem esta folga abrir o painel no celular vira sorte.
 */
export const FOLGA_DE_CLIQUE = 5;

export function foiArraste(de: Ponto, para: Ponto): boolean {
  return Math.abs(para.x - de.x) > FOLGA_DE_CLIQUE || Math.abs(para.y - de.y) > FOLGA_DE_CLIQUE;
}
