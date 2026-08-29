"use client";
/**
 * O canvas do Quadro Branco — Excalidraw embutido.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO: o Excalidraw só roda no navegador (usa
 * API de canvas e de fonte que não existem no servidor), então ele entra pelo
 * `dynamic(..., { ssr: false })` do `QuadroBranco.tsx`. Um import direto lá
 * quebraria a página inteira na renderização do servidor.
 *
 * POR QUE NÃO É MAIS CANVAS NOSSO: a primeira versão desenhava à mão em
 * `<canvas>` — traço, borracha, texto e desfazer escritos aqui dentro. Ficou
 * pobre de usar na frente de cliente, que é o único lugar onde esta tela
 * importa. O Excalidraw é MIT (livre inclusive para produto comercial, sem
 * marca d'água), tem a estética de rascunho à mão que a reunião pede, e traz
 * seta, forma, imagem, desfazer e zoom de graça.
 *
 * TEMA SEMPRE CLARO, de propósito: esta é a única tela do CRM que o CLIENTE vê,
 * projetada por compartilhamento de tela. Quadro escuro numa call é ilegível do
 * outro lado, e o tema do Mario não deveria decidir isso.
 */
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

interface Props {
  /** Cena inicial (rascunho restaurado do navegador). */
  initialElements: readonly unknown[];
  /** Entrega a API imperativa ao pai — é por ela que a conta é carimbada. */
  onApi: (api: unknown) => void;
  onChange: (elements: readonly unknown[]) => void;
}

export default function QuadroExcalidraw({ initialElements, onApi, onChange }: Props) {
  return (
    <Excalidraw
      theme="light"
      langCode="pt-BR"
      excalidrawAPI={(api) => onApi(api)}
      onChange={(elements) => onChange(elements)}
      initialData={{
        // O cast é o preço de manter o tipo do Excalidraw fora da fronteira
        // deste arquivo: o pai guarda a cena como dado opaco no rascunho, e só
        // aqui ela volta a ser elemento do editor.
        elements: initialElements as never,
        appState: { viewBackgroundColor: "#ffffff" },
        scrollToContent: true,
      }}
      UIOptions={{
        canvasActions: {
          // Sem "carregar arquivo": abre uma caixa de diálogo que não leva a
          // lugar nenhum aqui e rouba o clique errado na frente do cliente.
          loadScene: false,
          // Sem botão de tema: o quadro é compartilhado, e um clique sem
          // querer deixaria o cliente olhando uma tela preta no meio da call.
          toggleTheme: false,
        },
      }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}
