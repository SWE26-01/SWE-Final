import Image from "next/image"
import Link from "next/link"

import { FloorPlan } from "@/components/floor-plan"
import { AgentHub } from "@/components/agent-hub"
import { DesktopBranch } from "@/components/desktop-branch"

const homeUrl = process.env.NEXT_PUBLIC_HOME_URL || "http://localhost:3001"
const steps = [1, 2, 3, 4, 5, 6]

export function Showcase({ activeStep }: { activeStep: number }) {
  return (
    <main className="showcase">
      <nav className="stepper" aria-label="쇼케이스 메뉴">
        <ol className="stepper__track">
          {steps.map((step) => (
            <li key={step} className="stepper__item">
              <Link
                href={`/step/${step}`}
                className={`stepper__step${step < activeStep ? " stepper__step--complete" : ""}${step === activeStep ? " stepper__step--active" : ""}`}
                aria-current={step === activeStep ? "page" : undefined}
              >
                <span className="stepper__number" aria-hidden="true">{step}</span>
                <span className="sr-only">{step}번째 메뉴{step === activeStep ? ", 현재 페이지" : ""}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {activeStep === 3 && (
        <>
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
            <Image className="phone__frame" src="/thin-phone-frame.webp" alt="" fill priority sizes="430px" aria-hidden="true" />
          </section>
        </>
      )}
    </main>
  )
}
