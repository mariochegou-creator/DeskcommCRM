/** POST /api/v1/broadcasts/[id]/resume — volta a andar de onde parou. Idempotente. */
import type { NextRequest } from "next/server";

import { executarAcao } from "../_acoes";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return executarAcao(id, "resume");
}
