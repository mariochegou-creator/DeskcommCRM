"use client";
import Link from "next/link";

import { useAgentInbox } from "@/hooks/ai/useAgentInbox";
import { Bell } from "@/lib/ui/icons";
import { TOPBAR_BADGE, TOPBAR_ICON_BUTTON } from "./icon-button";

/**
 * Sino da central de avisos (Operação Visível F1): contador de avisos abertos
 * do runtime do agente no header; clique leva a /app/ai/inbox.
 */
export function AlertsBell() {
  const { data } = useAgentInbox("open");
  const count = data?.open_count ?? 0;

  return (
    <Link
      href="/app/ai/inbox"
      aria-label={count > 0 ? `Central de avisos — ${count} em aberto` : "Central de avisos"}
      data-testid="alerts-bell"
      className={TOPBAR_ICON_BUTTON}
    >
      <Bell size={18} aria-hidden />
      {count > 0 ? (
        <span data-testid="alerts-bell-count" className={TOPBAR_BADGE}>
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
