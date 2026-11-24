export function FloorPlan() {
  return (
    <section className="floor-plan" aria-label="1층 주택 평면도">
      <svg viewBox="0 0 900 560" role="img" aria-labelledby="plan-title plan-desc">
        <title id="plan-title">블루그레이 1층 주택 평면도</title>
        <desc id="plan-desc">발코니, 주방과 다이닝, 거실, 침실, 수납공간과 현관이 있는 평면도</desc>

        <g className="walls">
          <path d="M86 48H590V108H800V494H590V526H320V466H86Z" />
          <path d="M86 126H320M320 48V430M86 380H320M590 338H800M590 338V494M320 430H590" />
          <path d="M320 172H550V318H320M550 172V318" className="soft-wall" />
        </g>

        <g className="room-tints">
          <rect x="98" y="60" width="210" height="54" rx="9" />
          <rect x="604" y="352" width="182" height="128" rx="18" />
        </g>

        <g className="labels">
          <text x="203" y="94" textAnchor="middle">BALCONY</text>
          <text x="203" y="344" textAnchor="middle">DINING</text>
          <text x="203" y="366" textAnchor="middle">&amp; KITCHEN</text>
          <text x="695" y="146" textAnchor="middle">LIVING</text>
          <text x="695" y="374" textAnchor="middle">BEDROOM</text>
          <text x="193" y="412" textAnchor="middle">STORAGE</text>
          <text x="455" y="505" textAnchor="middle">ENTRANCE</text>
        </g>

        <g className="furniture">
          <g><rect x="126" y="152" width="94" height="92" rx="14" /><rect x="143" y="132" width="60" height="14" rx="5" /><rect x="143" y="250" width="60" height="14" rx="5" /><rect x="104" y="170" width="16" height="56" rx="5" /><rect x="226" y="170" width="16" height="56" rx="5" /><circle cx="173" cy="194" r="13" className="accent" /><path d="M173 207v22M164 229h18" /></g>
          <g><rect x="102" y="274" width="156" height="44" rx="8" /><circle cx="209" cy="288" r="7" /><circle cx="232" cy="288" r="7" /><circle cx="209" cy="308" r="7" /><circle cx="232" cy="308" r="7" /><path d="M114 284h43v24h-43zM136 284v24" /></g>
          <g><rect x="420" y="72" width="150" height="52" rx="17" /><path d="M462 72v52M528 72v52" /><rect x="398" y="86" width="24" height="36" rx="9" /><rect x="568" y="86" width="24" height="36" rx="9" /></g>
          <g><rect x="430" y="346" width="112" height="42" rx="8" /><rect x="446" y="356" width="80" height="21" rx="4" className="dark" /><path d="M486 377v8M466 385h40" /></g>
          <g><rect x="637" y="394" width="116" height="78" rx="13" className="bed" /><path d="M637 444h116M676 394v50M715 394v50" /><rect x="647" y="450" width="42" height="14" rx="6" /><rect x="699" y="450" width="42" height="14" rx="6" /></g>
        </g>

      </svg>
    </section>
  )
}
