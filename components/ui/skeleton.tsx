import { cn } from "@/lib/utils"

/**
 * Esqueleto neutro (`surface-elevated`), não tingido de accent: o que carrega
 * não é um destaque, é um lugar reservado.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-control bg-surface-elevated", className)}
      {...props}
    />
  )
}

export { Skeleton }
