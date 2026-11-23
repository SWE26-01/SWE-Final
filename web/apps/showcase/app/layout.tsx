import type { Metadata } from "next"

import "./styles.css"

export const metadata: Metadata = {
  title: "Smart Home Showcase",
  description: "Interactive mobile preview of the Smart Home app.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
