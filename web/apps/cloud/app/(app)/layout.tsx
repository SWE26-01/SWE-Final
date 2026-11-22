import { Suspense, type ReactNode } from "react"

import { DataProvider } from "@/components/data"
import { Shell } from "@/components/shell"

// The search params (which agent sheet is open) are read on the client, inside this boundary.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <DataProvider>
        <Shell>{children}</Shell>
      </DataProvider>
    </Suspense>
  )
}
