import Image from "next/image"

import { FloorPlan } from "@/components/floor-plan"
import { AgentHub } from "@/components/agent-hub"
import { DesktopBranch } from "@/components/desktop-branch"

const homeUrl = process.env.NEXT_PUBLIC_HOME_URL || "http://localhost:3001"

export function Showcase() {
  return (
    <main className="showcase">
      <div className="showcase__left">
        <AgentHub />
        <div className="floor-plan-wrap">
          <FloorPlan />
          <DesktopBranch />
        </div>
      </div>
      <section className="phone" aria-label="스마트홈 모바일 미리보기">
        <div className="phone__screen">
          <iframe className="phone__app" src={homeUrl} title="스마트홈 앱" />
        </div>
        <Image className="phone__frame" src="/dark-navy-phone-frame.png" alt="" fill priority sizes="430px" aria-hidden="true" />
      </section>
    </main>
  )
}
