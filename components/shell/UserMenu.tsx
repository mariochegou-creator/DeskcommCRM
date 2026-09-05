"use client";
import { useTransition } from "react";
import { useUser, useAuth } from "@/hooks/auth/AuthProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SignOut } from "@/lib/ui/icons";

function initials(name: string | null, email: string): string {
  if (name && name.trim()) {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const user = useUser();
  const { signOut } = useAuth();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Menu do usuário"
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full ring-offset-bg transition-shadow duration-fast hover:ring-2 hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
          >
            <Avatar className="h-8 w-8">
              {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
              <AvatarFallback className="bg-accent-soft text-xs font-semibold text-accent">
                {initials(user.full_name, user.email)}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{user.full_name ?? user.email}</span>
              <span className="truncate text-xs text-text-muted">{user.email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isPending} onClick={() => startTransition(async () => { await signOut(); })}>
            <SignOut size={16} className="mr-2" aria-hidden />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
