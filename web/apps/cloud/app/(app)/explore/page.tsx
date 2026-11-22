"use client"

// The catalog: agents people shared, the home's own and the caller's (Hub GET /agents?q=&shared=&mine=&sort=).
// Stars on the card; details and installing in the sheet. Agent Card URLs, for developers, in a dialog.
import { ArrowRight, Search } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { api, useApi } from "@workspace/core/api"
import { AgentCard } from "@workspace/core/components/agent-card"
import type { Agent } from "@workspace/core/types"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { useData } from "@/components/data"
import { PageHead } from "@/components/page-head"

const PAGE = 9

function AddByCard({ onAdded }: { onAdded: (a: Agent) => void }) {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onAdded(await api<Agent>("hub/agents/discover", { method: "POST", body: { card_url: url.trim() } }))
      setUrl("")
    } catch (err) {
      setError(err as Error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="grid gap-3" onSubmit={submit}>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… /.well-known/agent-card.json" required aria-label="Agent Card URL" />
        <Button type="submit" disabled={busy || !url.trim()}>{busy ? "읽는 중…" : "등록"}</Button>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
    </form>
  )
}

function Catalog() {
  const params = useSearchParams()
  const router = useRouter()
  const { openAgent } = useData()
  const query = params.get("q") ?? ""
  const [draft, setDraft] = useState(query)
  const [scope, setScope] = useState("all")
  const [sort, setSort] = useState("stars")
  const [shown, setShown] = useState(PAGE)
  const [adding, setAdding] = useState(false)
  useEffect(() => setDraft(query), [query])

  const search = new URLSearchParams({ sort })
  if (query.trim()) search.set("q", query.trim())
  if (scope === "shared") search.set("shared", "true")
  if (scope === "mine") search.set("mine", "true")
  const { data, error, reload } = useApi<Agent[]>(`hub/agents?${search}`)
  const results = data ?? []

  return (
    <>
      <PageHead eyebrow="AGENT CATALOG" title={query.trim() ? `“${query.trim()}” 검색 결과` : "에이전트 둘러보기"}>
        사람들이 만들어 공유한 에이전트를 찾아 우리 집에 설치하세요.
      </PageHead>
      <form className="mb-5 flex max-w-xl gap-2" role="search" onSubmit={(e) => { e.preventDefault(); router.push(draft.trim() ? `/explore?q=${encodeURIComponent(draft.trim())}` : "/explore") }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="이름, 설명, 만든 사람으로 찾기" className="h-10 rounded-xl pl-10" aria-label="에이전트 검색" />
        </div>
        <Button type="submit" className="h-10 rounded-xl">검색</Button>
      </form>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <ToggleGroup type="single" variant="outline" value={scope} onValueChange={(v) => { if (v) { setScope(v); setShown(PAGE) } }} aria-label="범위">
          <ToggleGroupItem value="all">전체</ToggleGroupItem>
          <ToggleGroupItem value="shared">공유된 에이전트</ToggleGroupItem>
          <ToggleGroupItem value="mine">내가 만든</ToggleGroupItem>
        </ToggleGroup>
        <span className="mr-auto text-sm text-muted-foreground">{data ? `${results.length}개` : "찾는 중…"}</span>
        <ToggleGroup type="single" size="sm" value={sort} onValueChange={(v) => v && setSort(v)} aria-label="정렬">
          <ToggleGroupItem value="stars">인기순</ToggleGroupItem>
          <ToggleGroupItem value="installs">설치순</ToggleGroupItem>
          <ToggleGroupItem value="new">최신순</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error.message}</AlertDescription></Alert>}
      {data && results.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-3 py-8 text-center text-sm text-muted-foreground">
            {scope === "mine" ? "아직 만든 에이전트가 없어요." : "맞는 에이전트가 없어요."}
            <Button asChild size="sm"><Link href="/studio">Agent Studio에서 만들기</Link></Button>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!data && [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        {results.slice(0, shown).map((a) => <AgentCard key={a.id} agent={a} onOpen={(x) => openAgent(x.id)} onChanged={reload} />)}
      </div>
      {results.length > shown && (
        <div className="mt-8 flex justify-center">
          <Button variant="secondary" size="lg" className="h-10 text-primary" onClick={() => setShown((n) => n + PAGE)}>더 많은 에이전트 보기 <ArrowRight /></Button>
        </div>
      )}
      <p className="mt-10 text-center text-sm text-muted-foreground">
        개발자이신가요?{" "}
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogTrigger asChild><Button variant="link" className="h-auto p-0">Agent Card URL로 직접 등록</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>외부 에이전트 등록</DialogTitle>
              <DialogDescription>A2A 1.0 Agent Card를 읽어 등록해요. 처음엔 나만 보이고, 에이전트 화면에서 공유하거나 연결할 수 있어요.</DialogDescription>
            </DialogHeader>
            <AddByCard onAdded={(a) => { setAdding(false); void reload(); openAgent(a.id) }} />
          </DialogContent>
        </Dialog>
      </p>
    </>
  )
}

export default function Explore() {
  return (
    <Suspense>
      <Catalog />
    </Suspense>
  )
}
