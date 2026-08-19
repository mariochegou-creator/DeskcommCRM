import { describe, expect, it } from "vitest";
import { APICallError, RetryError } from "ai";

import { permanentLlmErrorReason } from "@/lib/agent-engine/edge/llm/permanent-error";
import { LlmNotConfiguredError } from "@/lib/agent-engine/edge/llm/credentials";
import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import { runSilenceSweep, type SilenceSweepDb } from "@/lib/followup/silence-sweep";

/**
 * Pós-incidente 10/08/2026 (38 leads → 4.5k enrollments → 9.2k alertas):
 * congela (1) a classificação de erro permanente de LLM que dispara o
 * dead-letter imediato no worker, e (2) o cooldown de re-inscrição do sweep
 * de silêncio — as duas metades do conserto.
 */

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `provider disse ${statusCode}`,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode,
  });
}

describe("permanentLlmErrorReason", () => {
  it("classifica os erros tipados do harness como permanentes", () => {
    expect(permanentLlmErrorReason(new LlmNotConfiguredError())).toContain("credencial");
    expect(permanentLlmErrorReason(new LlmBudgetExceededError())).toContain("orçamento");
    expect(permanentLlmErrorReason(new LlmModelNotEnabledError("x"))).toContain("não habilitado");
    expect(
      permanentLlmErrorReason(new Error("modelo LLM não definido — configure ...")),
    ).toContain("modelo LLM não definido");
  });

  it("400/401 do provider são permanentes; 429/500 seguem retryable; erro comum é null", () => {
    expect(permanentLlmErrorReason(apiError(400))).toContain("HTTP 400"); // saldo esgotado vem como 400
    expect(permanentLlmErrorReason(apiError(401))).toContain("HTTP 401");
    expect(permanentLlmErrorReason(apiError(429))).toBeNull();
    expect(permanentLlmErrorReason(apiError(500))).toBeNull();
    expect(permanentLlmErrorReason(new Error("ECONNRESET"))).toBeNull();
  });

  it("desembrulha o RetryError do AI SDK até o erro real", () => {
    const wrapped = new RetryError({
      message: "não retryable",
      reason: "errorNotRetryable",
      errors: [apiError(401)],
    });
    expect(permanentLlmErrorReason(wrapped)).toContain("HTTP 401");
  });
});

describe("runSilenceSweep — cooldown de re-inscrição", () => {
  const POINTER = {
    id: "p1",
    organization_id: "org1",
    active_version_id: "v1",
    threshold_minutes: 60,
    segments: [],
    includeNeverReplied: false,
  };

  function fakeDb(overrides: Partial<SilenceSweepDb>): SilenceSweepDb {
    return {
      async loadActiveSilencePointers() {
        return [POINTER];
      },
      async loadSilentContactIds() {
        return ["c-frio", "c-recem-inscrito"];
      },
      async loadTriggerNodeId() {
        return "trigger-1";
      },
      async insertEnrollment() {
        return { inserted: true };
      },
      ...overrides,
    };
  }
  // Gate sempre aberto: o que está sob teste é o cooldown, não o gate.
  const gateDb = {
    async loadEnabledPublishedFollowupAgents() {
      return [{ agentId: "a1", pointerIds: ["p1"] }];
    },
  };

  it("pula contato com enrollment recente e inscreve o resto", async () => {
    const inscritos: string[] = [];
    const db = fakeDb({
      async loadRecentEnrollmentContactIds() {
        return ["c-recem-inscrito"];
      },
      async insertEnrollment(input) {
        inscritos.push(input.contact_id);
        return { inserted: true };
      },
    });
    const summary = await runSilenceSweep({ db, gateDb, clock: () => new Date("2026-08-19T12:00:00Z") });
    expect(summary.enrolled).toBe(1);
    expect(summary.skipped_cooldown).toBe(1);
    expect(inscritos).toEqual(["c-frio"]);
  });

  it("sem o método opcional (adapter antigo), não há cooldown — tudo inscreve", async () => {
    const summary = await runSilenceSweep({
      db: fakeDb({}),
      gateDb,
      clock: () => new Date("2026-08-19T12:00:00Z"),
    });
    expect(summary.enrolled).toBe(2);
    expect(summary.skipped_cooldown).toBe(0);
  });
});
