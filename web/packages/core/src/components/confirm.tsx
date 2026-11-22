"use client"

// `const [dialog, ask] = useConfirm()`; `await ask({title, body, confirm, danger})` is true when confirmed.
import { useCallback, useState, type ReactNode } from "react"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"

type Ask = { title: string; body?: ReactNode; confirm?: string; cancel?: string; danger?: boolean }

export function useConfirm(): [ReactNode, (opts: Ask) => Promise<boolean>] {
  const [pending, setPending] = useState<(Ask & { resolve: (v: boolean) => void }) | null>(null)
  const ask = useCallback((opts: Ask) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })), [])
  const done = (answer: boolean) => {
    pending?.resolve(answer)
    setPending(null)
  }
  const dialog = (
    <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && done(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={pending?.danger ? "text-destructive" : undefined}>{pending?.title}</AlertDialogTitle>
          {pending?.body && <AlertDialogDescription asChild><div className="grid gap-2 text-sm">{pending.body}</div></AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => done(false)}>{pending?.cancel ?? "취소"}</AlertDialogCancel>
          <AlertDialogAction
            className={pending?.danger ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={() => done(true)}
          >
            {pending?.confirm ?? "확인"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return [dialog, ask]
}
