import type { ReactNode } from "react"

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="mb-6 grid gap-2">
      <span className="text-xs font-bold tracking-[0.2em] text-primary">{eyebrow}</span>
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="max-w-2xl text-muted-foreground">{children}</div>}
    </section>
  )
}
