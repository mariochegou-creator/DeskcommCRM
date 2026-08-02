import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { GuideReader } from "@/app/app/settings/guias/[slug]/_client";
import { getGuide } from "@/lib/guides";

// jsdom não implementa IntersectionObserver, e o scroll spy do índice depende
// dele. Stub silencioso: o que este teste verifica é o conteúdo renderizado e o
// filtro de busca — o destaque por rolagem não tem como acontecer sem rolagem.
beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    },
  );
});

const guide = getGuide("crm-completo");

describe("GuideReader", () => {
  it("renderiza o guia inteiro com índice navegável", () => {
    expect(guide).toBeTruthy();
    if (!guide) return;

    render(<GuideReader guide={guide} />);

    expect(screen.getByRole("heading", { level: 1, name: guide.title })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Índice do guia" })).toBeInTheDocument();

    // Uma seção de cada extremo do documento: se o parser cortasse o conteúdo no
    // meio, o índice ainda pareceria certo e só o fim sumiria.
    expect(screen.getAllByText(/Inbox — atender/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Problemas comuns/).length).toBeGreaterThan(0);

    // Tabela de verdade, não parágrafo com barra vertical.
    expect(screen.getAllByRole("table").length).toBeGreaterThan(3);
  });

  it("a busca filtra as seções e ignora acento", async () => {
    if (!guide) return;
    const user = userEvent.setup();
    render(<GuideReader guide={guide} />);

    await user.type(screen.getByLabelText("Buscar no guia"), "anonimiza");

    expect(screen.getAllByText(/LGPD/).length).toBeGreaterThan(0);
    expect(screen.queryByText("7. Inbox — atender")).not.toBeInTheDocument();
  });

  it("busca sem resultado explica em vez de mostrar tela vazia", async () => {
    if (!guide) return;
    const user = userEvent.setup();
    render(<GuideReader guide={guide} />);

    await user.type(screen.getByLabelText("Buscar no guia"), "zzzzqqqq");

    expect(screen.getByText(/Nada encontrado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Limpar a busca/ })).toBeInTheDocument();
  });
});
