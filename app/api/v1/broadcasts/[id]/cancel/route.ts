/**
 * POST /api/v1/broadcasts/[id]/cancel — encerra de vez e esvazia a fila.
 * Terminal: o que já saiu não volta, e continua no relatório.
 */
import type { NextRequest } from "next/server";

import { executarAcao } from "../_acoes";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return executarAcao(id, "cancel");
}
