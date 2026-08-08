/**
 * A detecção decide PARA ONDE a seção "// prospecção" do Painel aponta — errar
 * aqui não quebra nada visível: mostra métricas verdadeiras do funil errado.
 * Por isso os casos negativos importam tanto quanto os positivos.
 */
import { describe, it, expect } from "vitest";

import {
  detectProspectingPipeline,
  type PipelineCandidate,
  type StageSlugRow,
} from "./prospecting-pipeline";

const pipe = (
  over: Partial<PipelineCandidate> & { id: string },
): PipelineCandidate => ({
  name: "Funil",
  slug: null,
  position: 1000,
  ...over,
});

const stage = (pipeline_id: string, slug: string | null): StageSlugRow => ({
  pipeline_id,
  slug,
});

describe("detectProspectingPipeline", () => {
  it("funil com etapas r1-* e r2-* vence, mesmo sem 'prospecção' no nome", () => {
    const pipelines = [
      pipe({ id: "pedidos", name: "Pedidos", position: 1 }),
      pipe({ id: "nexo", name: "Funil NEXO IA", position: 2 }),
    ];
    const stages = [
      stage("pedidos", "carrinho-abandonado"),
      stage("nexo", "captacao"),
      stage("nexo", "r1-agendada"),
      stage("nexo", "r2-agendada"),
    ];
    expect(detectProspectingPipeline(pipelines, stages)).toEqual({
      id: "nexo",
      name: "Funil NEXO IA",
    });
  });

  it("só r1 SEM r2 não basta — cai no fallback de nome, e sem nome devolve null", () => {
    const pipelines = [pipe({ id: "meio", name: "Vendas" })];
    const stages = [stage("meio", "r1-agendada"), stage("meio", "fechado")];
    expect(detectProspectingPipeline(pipelines, stages)).toBeNull();
  });

  it("fallback: nome com 'prospec' (qualquer caixa) quando nenhum funil tem r1+r2", () => {
    const pipelines = [
      pipe({ id: "pedidos", name: "Pedidos", position: 1 }),
      pipe({ id: "pros", name: "Prospecção fria", position: 2 }),
    ];
    expect(detectProspectingPipeline(pipelines, [])).toEqual({
      id: "pros",
      name: "Prospecção fria",
    });
  });

  it("fallback também casa pelo slug", () => {
    const pipelines = [
      pipe({ id: "p1", name: "Comercial", slug: "prospeccao-2026" }),
    ];
    expect(detectProspectingPipeline(pipelines, [])).toEqual({
      id: "p1",
      name: "Comercial",
    });
  });

  it("empate de r1+r2 em dois funis: vence o de menor position", () => {
    const pipelines = [
      pipe({ id: "b", name: "Funil B", position: 20 }),
      pipe({ id: "a", name: "Funil A", position: 10 }),
    ];
    const stages = [
      stage("a", "r1-feita"),
      stage("a", "r2-feita"),
      stage("b", "r1-agendada"),
      stage("b", "r2-agendada"),
    ];
    expect(detectProspectingPipeline(pipelines, stages)).toEqual({
      id: "a",
      name: "Funil A",
    });
  });

  it("sinal forte tem precedência sobre o nome: r1+r2 vence 'Prospecção' de outro funil", () => {
    const pipelines = [
      pipe({ id: "nome", name: "Prospecção", position: 1 }),
      pipe({ id: "etapas", name: "Comercial", position: 2 }),
    ];
    const stages = [stage("etapas", "r1-agendada"), stage("etapas", "r2-feita")];
    expect(detectProspectingPipeline(pipelines, stages)).toEqual({
      id: "etapas",
      name: "Comercial",
    });
  });

  it("nada casou ⇒ null (a seção não renderiza — melhor ausente que apontando errado)", () => {
    const pipelines = [pipe({ id: "pedidos", name: "Pedidos" })];
    const stages = [stage("pedidos", "carrinho-abandonado")];
    expect(detectProspectingPipeline(pipelines, stages)).toBeNull();
  });

  it("etapa sem slug não derruba a detecção", () => {
    const pipelines = [pipe({ id: "x", name: "Funil X" })];
    const stages = [stage("x", null), stage("x", "r1-agendada"), stage("x", "r2-feita")];
    expect(detectProspectingPipeline(pipelines, stages)).toEqual({
      id: "x",
      name: "Funil X",
    });
  });
});
