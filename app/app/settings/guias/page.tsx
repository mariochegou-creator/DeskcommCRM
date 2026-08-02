import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BookOpen, Clock, Users } from "@/lib/ui/icons";
import { requireAuth } from "@/lib/auth/server";
import { listGuides } from "@/lib/guides";

export const dynamic = "force-dynamic";

export const metadata = { title: "Guias" };

export default async function GuidesHubPage() {
  // Sem gate de papel: guia é material de uso, e esconder o manual de quem só
  // tem `viewer` é como entregar o carro sem o manual porque a pessoa não dirige.
  await requireAuth();
  const guides = listGuides();

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Guias</h1>
        <p className="text-sm text-muted-foreground">
          Manuais de uso do CRM. Leia do começo na primeira semana; depois use a busca.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {guides.map((guide) => (
          <Link key={guide.slug} href={`/app/settings/guias/${guide.slug}`} className="block">
            <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-border-strong">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <BookOpen size={16} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{guide.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{guide.description}</p>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="neutral" className="gap-1">
                  <Users size={12} aria-hidden />
                  {guide.audience}
                </Badge>
                <Badge variant="neutral" className="gap-1">
                  <Clock size={12} aria-hidden />
                  {guide.minutes} min
                </Badge>
                <span className="tabular-nums">{guide.sections.length} seções</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
