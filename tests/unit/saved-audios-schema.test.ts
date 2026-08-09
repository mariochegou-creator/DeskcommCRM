import { describe, expect, it } from "vitest";

import {
  attachSavedAudioSchema,
  createSavedAudioSchema,
  updateSavedAudioSchema,
} from "@/lib/schemas/saved-audios";

describe("createSavedAudioSchema", () => {
  it("multipart manda tudo string: shared vira boolean e duração vira número", () => {
    const parsed = createSavedAudioSchema.parse({
      title: "  abertura  ",
      shared: "true",
      duration_seconds: "12",
    });
    expect(parsed).toEqual({ title: "abertura", shared: true, duration_seconds: 12 });
  });

  it("sem shared, o áudio é pessoal", () => {
    expect(createSavedAudioSchema.parse({ title: "abertura" }).shared).toBe(false);
  });

  it("recusa título vazio e shared fora do par true/false", () => {
    expect(createSavedAudioSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createSavedAudioSchema.safeParse({ title: "ok", shared: "sim" }).success).toBe(false);
  });
});

describe("updateSavedAudioSchema", () => {
  it("exige título não vazio", () => {
    expect(updateSavedAudioSchema.safeParse({ title: "nova abertura" }).success).toBe(true);
    expect(updateSavedAudioSchema.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("attachSavedAudioSchema", () => {
  it("conversation_id precisa ser uuid", () => {
    expect(
      attachSavedAudioSchema.safeParse({ conversation_id: "3f1e0b8a-2c6a-4f6b-9d7e-1a2b3c4d5e6f" }).success,
    ).toBe(true);
    expect(attachSavedAudioSchema.safeParse({ conversation_id: "conv-1" }).success).toBe(false);
  });
});
