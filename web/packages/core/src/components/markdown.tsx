// Agents answer in Markdown. This renders what they use (headings, lists, tables, bold, code) as
// React elements: no HTML from a reply ever reaches the page.
import type { ReactNode } from "react"

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    out.push(
      token.startsWith("**") ? (
        <strong key={`${key}b${m.index}`}>{token.slice(2, -2)}</strong>
      ) : (
        <code key={`${key}c${m.index}`} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{token.slice(1, -1)}</code>
      ),
    )
    last = m.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
const BULLET = /^\s*([-*•]|\d+[.)])\s+/

export function Markdown({ text }: { text: string }) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n")
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i += 1
      continue
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      blocks.push(<p key={i} className="mt-2 font-semibold">{inline(heading[1]!, `h${i}`)}</p>)
      i += 1
      continue
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isRule(lines[i + 1]!)) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!))
      blocks.push(
        <div key={`t${i}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="border-b bg-primary/5 px-2 py-1.5 text-left font-semibold text-muted-foreground">{inline(c, `th${i}${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j} className="border-b px-2 py-1.5 align-top">{inline(c, `td${i}${k}${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (BULLET.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && BULLET.test(lines[i]!)) items.push(lines[i++]!.replace(BULLET, ""))
      const List = ordered ? "ol" : "ul"
      blocks.push(
        <List key={`l${i}`} className={`grid gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, j) => <li key={j}>{inline(it, `li${i}${j}`)}</li>)}
        </List>,
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^#{1,6}\s/.test(lines[i]!) && !BULLET.test(lines[i]!) && !lines[i]!.trim().startsWith("|")) para.push(lines[i++]!)
    if (para.length === 0) para.push(lines[i++]!)
    blocks.push(<p key={`p${i}`}>{para.map((p, j) => <span key={j}>{j > 0 && <br />}{inline(p, `p${i}${j}`)}</span>)}</p>)
  }
  return <div className="grid gap-2 text-sm leading-relaxed">{blocks}</div>
}
