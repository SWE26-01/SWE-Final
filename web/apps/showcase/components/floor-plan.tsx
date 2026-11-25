export function FloorPlan() {
  return (
    <section className="floor-plan" aria-label="파스텔톤 아파트 평면도">
      <svg viewBox="0 0 1200 610" role="img" aria-labelledby="plan-title plan-desc">
        <title id="plan-title">파스텔톤 아파트 평면도</title>
        <desc id="plan-desc">침실, 욕실, 아이방, 거실, 서재, 주방, 세탁실과 발코니로 구성된 아파트 평면도</desc>

        <defs>
          <clipPath id="clip-bedroom"><rect x="30" y="30" width="350" height="220" /></clipPath>
          <clipPath id="clip-bath"><rect x="380" y="30" width="160" height="220" /></clipPath>
          <clipPath id="clip-toilet"><rect x="540" y="30" width="80" height="220" /></clipPath>
          <clipPath id="clip-kids"><rect x="620" y="30" width="220" height="220" /></clipPath>
          <clipPath id="clip-living"><rect x="840" y="30" width="330" height="300" /></clipPath>
          <clipPath id="clip-study"><rect x="30" y="250" width="220" height="140" /></clipPath>
          <clipPath id="clip-kitchen"><rect x="250" y="390" width="340" height="180" /></clipPath>
          <clipPath id="clip-laundry"><rect x="590" y="390" width="170" height="180" /></clipPath>
          <clipPath id="clip-balcony"><rect x="840" y="330" width="330" height="140" /></clipPath>
        </defs>

        <g className="room-fills" aria-hidden="true">
          <path className="room-fill room-fill--bedroom" d="M30 30H380V250H30Z" />
          <path className="room-fill room-fill--neutral" d="M380 30H620V250H380Z" />
          <path className="room-fill room-fill--kids" d="M620 30H840V250H620Z" />
          <path className="room-fill room-fill--living" d="M840 30H1170V330H840Z" />
          <path className="room-fill room-fill--study" d="M30 250H250V390H30Z" />
          <path className="room-fill room-fill--hall" d="M250 250H840V390H250Z" />
          <path className="room-fill room-fill--kitchen" d="M250 390H590V570H250Z" />
          <path className="room-fill room-fill--laundry" d="M590 390H760V570H590Z" />
          <path className="room-fill room-fill--balcony" d="M840 330H1170V470H840Z" />
        </g>

        <g className="walls">
          <path d="M30 390V30H1170V470H840V390M760 390V570H250V390M250 390H30" />
          <path d="M30 250H380V30M250 250V390M380 30V250M540 30V250M620 30V250M840 30V330M840 330H1170" />
          <path className="soft-wall" d="M380 168H540M620 168H840M250 390H760" />
          <path className="major-divider" d="M590 390V570" />
        </g>

        <g className="windows" aria-hidden="true">
          <path d="M108 30H290M430 30H500M675 30H755M920 30H1080M1170 120V225M930 470H1080" />
        </g>

        <g className="labels">
          <text x="205" y="225" textAnchor="middle">BEDROOM</text>
          <text x="460" y="225" textAnchor="middle">BATH</text>
          <text x="580" y="225" textAnchor="middle">TOILET</text>
          <text x="730" y="225" textAnchor="middle">KIDS ROOM</text>
          <text x="1005" y="300" textAnchor="middle">LIVING ROOM</text>
          <text x="140" y="375" textAnchor="middle">STUDY ROOM</text>
          <text x="420" y="540" textAnchor="middle">KITCHEN &amp; DINING</text>
          <text x="510" y="350" textAnchor="middle">HALL</text>
          <text x="675" y="425" textAnchor="middle">LAUNDRY</text>
          <text x="1005" y="380" textAnchor="middle">BALCONY</text>
        </g>

        <g className="furniture">
          <g className="furniture-item furniture-item--bedroom" clipPath="url(#clip-bedroom)">
            <rect x="92" y="62" width="184" height="124" rx="16" className="bed" />
            <rect x="105" y="74" width="72" height="34" rx="9" />
            <rect x="190" y="74" width="72" height="34" rx="9" />
            <path d="M92 119h184M184 119v67" />
            <rect x="54" y="90" width="27" height="35" rx="5" />
            <circle cx="67.5" cy="107" r="4" />
          </g>
          <g className="furniture-item furniture-item--bath" clipPath="url(#clip-bath)">
            <rect x="398" y="58" width="112" height="72" rx="30" />
            <path d="M410 70h88v48h-88" />
            <rect x="468" y="142" width="48" height="30" rx="12" />
            <circle cx="503" cy="157" r="4" />
          </g>
          <g className="furniture-item furniture-item--toilet" clipPath="url(#clip-toilet)">
            <rect x="560" y="58" width="40" height="34" rx="6" />
            <path d="M565 92c0 48 30 48 30 0M572 112h16" />
          </g>
          <g className="furniture-item furniture-item--kids" clipPath="url(#clip-kids)">
            <rect x="650" y="58" width="92" height="124" rx="14" className="bed" />
            <rect x="660" y="68" width="72" height="30" rx="8" />
            <path d="M650 108h92" />
            <rect x="766" y="72" width="48" height="76" rx="8" />
            <circle cx="790" cy="166" r="16" />
          </g>
          <g className="furniture-item furniture-item--living" clipPath="url(#clip-living)">
            <rect x="872" y="66" width="158" height="76" rx="20" />
            <path d="M892 66v76M1010 66v76M892 104h118" />
            <rect x="930" y="174" width="78" height="48" rx="13" />
            <rect x="1094" y="66" width="48" height="164" rx="7" className="dark" />
            <path d="M1107 84h22M1107 213h22" />
          </g>
          <g className="furniture-item furniture-item--study" clipPath="url(#clip-study)">
            <rect x="58" y="278" width="132" height="50" rx="7" />
            <rect x="94" y="287" width="60" height="26" rx="4" />
            <path d="M124 313v9M109 322h30" />
            <rect x="104" y="338" width="44" height="24" rx="8" />
            <rect x="207" y="276" width="24" height="82" rx="3" />
            <path d="M207 298h24M207 322h24" />
          </g>
          <g className="furniture-item furniture-item--kitchen" clipPath="url(#clip-kitchen)">
            <rect x="270" y="414" width="45" height="118" rx="5" />
            <path d="M281 428h23M281 446h23M281 464h23" />
            <circle cx="281" cy="506" r="6" />
            <circle cx="301" cy="506" r="6" />
            <rect x="356" y="420" width="156" height="74" rx="12" />
            <circle cx="378" cy="410" r="12" />
            <circle cx="418" cy="410" r="12" />
            <circle cx="458" cy="410" r="12" />
            <circle cx="498" cy="410" r="12" />
            <circle cx="378" cy="504" r="12" />
            <circle cx="418" cy="504" r="12" />
            <circle cx="458" cy="504" r="12" />
            <circle cx="498" cy="504" r="12" />
          </g>
          <g className="furniture-item furniture-item--laundry" clipPath="url(#clip-laundry)">
            <rect x="622" y="458" width="76" height="78" rx="9" />
            <circle cx="660" cy="497" r="24" />
            <rect x="710" y="450" width="30" height="88" rx="4" />
            <path d="M710 474h30M710 498h30" />
          </g>
          <g className="furniture-item furniture-item--balcony" clipPath="url(#clip-balcony)">
            <circle cx="1004" cy="424" r="22" />
            <path d="M1004 402v44M982 424h44" />
            <rect x="944" y="406" width="34" height="42" rx="13" />
            <rect x="1030" y="406" width="34" height="42" rx="13" />
            <path d="M1132 432c-22-18-16-47 2-57M1132 432c22-18 16-47-2-57M1132 432v26" />
          </g>
        </g>
      </svg>
    </section>
  )
}
