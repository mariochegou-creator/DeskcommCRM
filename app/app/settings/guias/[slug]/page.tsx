import { notFound } from "next/navigation";

import { requireAuth } from "@/lib/auth/server";
import { getGuide, listGuides } from "@/lib/guides";
import { GuideReader } from "./_client";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return listGuides().map((guide) => ({ slug: guide.slug }));
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAuth();

  const guide = getGuide(slug);
  if (!guide) notFound();

  return <GuideReader guide={guide} />;
}
