const homeUrl = process.env.NEXT_PUBLIC_HOME_URL || "http://localhost:3001"

export default function ShowcasePage() {
  return (
    <main className="showcase">
      <section className="phone" aria-label="스마트홈 모바일 미리보기">
        <span className="side-button side-button--silent" aria-hidden="true" />
        <span className="side-button side-button--volume-up" aria-hidden="true" />
        <span className="side-button side-button--volume-down" aria-hidden="true" />
        <span className="side-button side-button--power" aria-hidden="true" />

        <div className="phone__screen">
          <div className="phone__island" aria-hidden="true" />
          <iframe className="phone__app" src={homeUrl} title="스마트홈 앱" />
        </div>
      </section>
    </main>
  )
}
