"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProfile } from "@/app/actions/settings/updateProfile";
import { profileSchema, type Locale } from "@/lib/schemas/settings";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { rotuloDoNumero } from "@/components/inbox/NumeroDeSaida";

/** Valor do Select para "nenhum vínculo" — Select não aceita value vazio. */
const SEM_NUMERO = "none";

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Recife",
  "America/Fortaleza",
  "UTC",
];

interface Props {
  email: string;
  initialFullName: string | null;
  initialAvatarUrl: string | null;
}

export function ProfileForm({ email, initialFullName, initialAvatarUrl }: Props) {
  const { user, activeOrg } = useAuth();
  const { data: canais } = useChannelSessions();
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl ?? "");
  const [meuNumero, setMeuNumero] = useState(
    (activeOrg && user.meu_numero?.[activeOrg.orgId]) || SEM_NUMERO,
  );
  const [isPending, startTransition] = useTransition();

  // Com um número só não há vínculo a escolher; o campo aparece a partir de 2 —
  // o mesmo limiar do seletor "Falando pelo" do inbox.
  const mostrarMeuNumero = (canais?.length ?? 0) >= 2;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = profileSchema.safeParse({
      full_name: fullName || null,
      locale,
      timezone,
      avatar_url: avatarUrl || null,
      meu_numero_channel_id: meuNumero === SEM_NUMERO ? null : meuNumero,
    });
    if (!parsed.success) {
      toast.error("Dados inválidos.");
      return;
    }
    startTransition(async () => {
      const r = await updateProfile(parsed.data);
      if (r.ok) toast.success("Perfil atualizado.");
      else toast.error(`Erro: ${r.error}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl">
      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled />
          <p className="text-xs text-muted-foreground">
            Trocar email — em breve.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="full_name">Nome completo</Label>
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="locale">Idioma</Label>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger id="locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="en-US">English (US)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Fuso horário</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {mostrarMeuNumero && (
          <div className="space-y-2">
            <Label htmlFor="meu_numero">Meu número de WhatsApp</Label>
            <Select value={meuNumero} onValueChange={setMeuNumero}>
              <SelectTrigger id="meu_numero">
                <SelectValue placeholder="Sem número padrão" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_NUMERO}>Sem número padrão</SelectItem>
                {canais?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {rotuloDoNumero(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O inbox abre neste número e conversa nova sai por ele. Vale para a
              sua conta em qualquer computador.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="avatar_url">Avatar URL</Label>
          <Input
            id="avatar_url"
            type="url"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Upload de arquivo — em breve. Cole uma URL pública.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
