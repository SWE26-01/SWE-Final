import { notFound } from "next/navigation"

import { Showcase } from "@/components/showcase"

export default async function StepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params
  const activeStep = Number(step)

  if (!Number.isInteger(activeStep) || activeStep < 1 || activeStep > 6) notFound()

  return <Showcase activeStep={activeStep} />
}
