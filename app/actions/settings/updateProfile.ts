"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { profileSchema, type ProfileInput } from "@/lib/schemas/settings";
import { resolveActiveOrg, loadAuthUser } from "@/lib/auth/server";

export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function updateProfile(input: ProfileInput): Promise<UpdateProfileResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const activeOrg = await resolveActiveOrg(authUser);

  // "Meu número" é por org: o mapa inteiro é reescrito (updateUser substitui a
  // chave toda), então parte do que já está gravado e mexe só na org ativa.
  const meuNumero: Record<string, string> = { ...(authUser.meu_numero ?? {}) };
  if (parsed.data.meu_numero_channel_id !== undefined && activeOrg) {
    if (parsed.data.meu_numero_channel_id === null) {
      delete meuNumero[activeOrg.orgId];
    } else {
      // O id precisa ser um número DESTA org — a RLS só devolve canal que o
      // usuário pode ver, então um id de outra org (ou inventado) morre aqui.
      const { data: canal } = await supabase
        .from("channel_sessions")
        .select("id")
        .eq("id", parsed.data.meu_numero_channel_id)
        .eq("organization_id", activeOrg.orgId)
        .maybeSingle();
      if (!canal) {
        return { ok: false, error: "channel_not_found" };
      }
      meuNumero[activeOrg.orgId] = parsed.data.meu_numero_channel_id;
    }
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      full_name: parsed.data.full_name ?? null,
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
      avatar_url: parsed.data.avatar_url ?? null,
      meu_numero: meuNumero,
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  await audit({
    action: "profile.updated",
    actorUserId: authUser.id,
    organizationId: activeOrg?.orgId ?? null,
    resourceType: "user",
    resourceId: authUser.id,
    requestId,
    ip,
    userAgent,
    metadata: {
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
    },
  });

  // Best-effort emit (event_log is org-scoped; skip if no org).
  if (activeOrg) {
    await supabase
      .rpc("emit_event", {
        p_event_type: "user.profile_updated",
        p_entity_kind: "user",
        p_entity_id: authUser.id,
        p_payload: { user_id: authUser.id },
        p_metadata: { request_id: requestId },
        p_organization_id: activeOrg.orgId,
      })
      .then(({ error: e }) => {
        if (e) console.error("[updateProfile] emit_event failed", e.message);
      });
  }

  revalidatePath("/app/settings/profile");
  // O AuthProvider recebe o usuário do layout — sem revalidar o layout, o
  // "meu número" novo só chegaria ao inbox depois de um F5.
  revalidatePath("/app", "layout");
  return { ok: true };
}
