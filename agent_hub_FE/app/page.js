"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const agents = [
  { id: "health", name: "Hospital Agent", note: "Daily wellness", x: 22, y: 22, icon: "✦", labelSide: "right", points: [[5, 10], [4, 36]] },
  { id: "roommate", name: "Roommate Agent", note: "Shared living", x: 18, y: 76, icon: "✦", labelSide: "right", points: [[5, 62], [6, 91], [50, 94]] },
  { id: "coffee", name: "Coffee Agent", note: "Coffee routine", x: 87, y: 18, icon: "✦", labelSide: "left", points: [[76, 7], [96, 34]] },
  { id: "baby", name: "Baby Care", note: "Gentle routines", x: 88, y: 54, icon: "✦", labelSide: "bottom", points: [[77, 42], [97, 40]] },
  { id: "music", name: "Music Agent", note: "Mood & sound", x: 79, y: 82, icon: "✦", labelSide: "left", points: [[93, 94]] },
];

const agentTopics = {
  health: ["Cardiology Agent", "Orthopedics Agent", "Room Agents", "Patient Info Agent"],
  roommate: ["Smart TV", "Smart Lock", "Robot Vacuum", "Washing Machine", "Energy Monitor", "Shared Lighting"],
  coffee: ["Coffee Machine", "Smart Plug", "Water Purifier", "Kitchen Light", "Smart Speaker", "Routine Button"],
  baby: ["Baby Monitor", "Night Light", "Air Purifier", "Humidifier", "Smart Camera", "White Noise"],
  music: ["Smart TV", "Smart Speaker", "Soundbar", "Mood Lighting", "Multi-room Audio", "Voice Assistant"],
};

const topicPositions = [
  [16, 28], [27, 72], [67, 69], [14, 83], [86, 78], [84, 29],
];

const hospitalTopicPositions = [
  [24, 22], [76, 22], [50, 84], [88, 82],
];

const simulationSteps = [
  {
    sender: "Cardiology Agent", task: "transfer.request", description: "환자 이송 요청", from: "cardiology", to: "hospital",
    payload: [["Patient ID", "P-1024"], ["Target Department", "Orthopedics"], ["Approval ID", "APR-0081"]],
  },
  {
    sender: "Hospital Agent", task: "patient.transfer_context", description: "환자 이송 정보 조회", from: "hospital", to: "patientInfo",
    payload: [["patient_id", "P-1024"], ["medical_history", "심부전, 부정맥"], ["diagnosis", "대퇴골 골절"], ["transfer_precaution", "심혈관 상태 관찰"]],
  },
  {
    sender: "Hospital Agent", task: "transfer.acceptance_request", description: "환자 수용 및 병실 확인 요청", from: "hospital", to: "orthopedics",
    payload: [["Patient ID", "P-1024"], ["Diagnosis", "대퇴골 골절"], ["Monitoring", "HR · SpO₂ · ECG"], ["Request", "병실 수용 확인"]],
  },
  {
    sender: "Orthopedics Agent", task: "room.status_request", description: "병실 상태 조회", from: "orthopedics", to: "room",
    payload: [["Room", "302"], ["Available Beds", "1"], ["Temperature", "23°C"], ["HVAC / Ventilation", "정상"]],
  },
  {
    sender: "Room Agents", task: "patient.monitoring_requirements", description: "환자 요구사항 조회", from: "room", to: "patientInfo",
    payload: [["Patient ID", "P-1024"], ["Purpose", "이송 후 모니터링"], ["Requested Data", "심장질환 · 필요 기기"]],
  },
  {
    sender: "Patient Info Agent", task: "patient.monitoring_context", description: "모니터링 준비 정보 반환", from: "patientInfo", to: "room",
    payload: [["Patient ID", "P-1024"], ["Monitoring", "HR · SpO₂ · ECG"], ["Required Devices", "ECG Monitor · SpO₂ Sensor"], ["Precaution", "심혈관 상태 관찰"]],
  },
  {
    sender: "Room Agents", task: "room.device_check", description: "병실 기기 상태 점검", from: "room", to: "room", internal: true,
    payload: [["Room", "302"], ["ECG Monitor", "Connected"], ["SpO₂ Sensor", "Connected"], ["Heart Rate", "Operational"]],
  },
  {
    sender: "Room Agents", task: "task.status", description: "병실 준비 결과 반환", from: "room", to: "orthopedics",
    payload: [["Room", "302"], ["Environment", "Normal"], ["Available Beds", "1"], ["Devices", "Ready"]],
  },
  {
    sender: "Orthopedics Agent", task: "transfer.ready", description: "환자 수용 및 병실 준비 완료", from: "orthopedics", to: "hospital",
    payload: [["Patient ID", "P-1024"], ["Acceptance", "Approved"], ["Assigned Room", "302"], ["Room Status", "Ready"]],
  },
  {
    sender: "Hospital Agent", task: "transfer.ready", description: "이송 진행 가능 상태 알림", from: "hospital", to: "cardiology",
    payload: [["Patient ID", "P-1024"], ["Destination", "Room 302"], ["Transfer Status", "Ready"]],
  },
];

const tabs = ["Agent Hub", "My Agent", "Agent Studio"];

const tabRouteNames = {
  "My Agent": "my-agent",
  "Agent Studio": "agent-studio",
};

function readRouteState() {
  const params = new URLSearchParams(window.location.search);
  const tab = Object.entries(tabRouteNames).find(([, route]) => route === params.get("tab"))?.[0];
  const selectedAgent = agents.find((agent) => agent.id === params.get("agent")) || null;

  if (tab) return { activeTab: tab, query: "", selectedAgent: null, showResults: false, isAgentPlaying: false };
  if (selectedAgent) {
    return {
      activeTab: "Agent Hub",
      query: "",
      selectedAgent,
      showResults: false,
      isAgentPlaying: selectedAgent.id === "health" && params.get("mode") === "play",
    };
  }

  return {
    activeTab: "Agent Hub",
    query: params.get("view") === "search" ? (params.get("q") || "baby") : "",
    selectedAgent: null,
    showResults: params.get("view") === "search",
    isAgentPlaying: false,
  };
}

const babyResults = [
  { name: "Baby Care Agent", note: "A calm routine for everyday care.", features: ["Baby Monitor", "Air Purifier", "Night Light", "Bottle Warmer", "Smart Thermometer", "Diaper Sensor"] },
  { name: "Baby Sleep Agent", note: "A gentler setup for better sleep.", features: ["White Noise Machine", "Room Thermostat", "Sleep Sensor", "Smart Crib", "Blackout Blinds", "Humidifier"] },
  { name: "Baby Watch Agent", note: "Keep important moments within reach.", features: ["Smart Camera", "Motion Sensor", "Two-way Audio", "Door Sensor", "Cry Detector", "Wearable Monitor"] },
  { name: "Growth Agent", note: "Follow changing needs as your baby grows.", features: ["Smart Scale", "Height Sensor", "Feeding Tracker", "Activity Mat", "Health Monitor", "Daily Report"] },
  { name: "Baby Feeding Agent", note: "Make every feeding routine easier to follow.", features: ["Bottle Warmer", "Formula Maker", "Feeding Tracker", "Smart Kettle", "Milk Monitor", "Kitchen Light"] },
  { name: "Baby Safety Agent", note: "Watch over the spaces your baby explores.", features: ["Smart Gate", "Window Sensor", "Outlet Monitor", "Air Quality Sensor", "Room Camera", "Emergency Button"] },
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l10-6.5z" />
    </svg>
  );
}

function CardiologyIcon() {
  return (
    <svg viewBox="0 0 32 28" aria-hidden="true">
      <path d="M16 25S3.5 18.2 3.5 9.6A6.2 6.2 0 0 1 16 7.8a6.2 6.2 0 0 1 12.5 1.8C28.5 18.2 16 25 16 25Z" />
      <path d="M5.5 14h5l2.1-4.2 3.2 8.3 2.5-5.1 1.4 1h6.8" />
    </svg>
  );
}

function OrthopedicsIcon() {
  return (
    <svg className="line-icon" viewBox="0 0 32 28" aria-hidden="true">
      <path fill="none" d="M9 8.5a3 3 0 1 1 2.8-4.1l8.4 8.4a3 3 0 1 1 3.4 3.4l-8.4-8.4A3 3 0 0 1 9 8.5Zm14 11a3 3 0 1 1-2.8 4.1l-8.4-8.4a3 3 0 1 1-3.4-3.4l8.4 8.4a3 3 0 0 1 6.2-.7Z" />
    </svg>
  );
}

function RoomIcon() {
  return (
    <svg className="line-icon" viewBox="0 0 32 28" aria-hidden="true">
      <path fill="none" d="M4 22V9m0 8h24v5M8 13h7a3 3 0 0 1 3 3v1H8v-4Zm10 0h7a3 3 0 0 1 3 3v1H18v-4Z" />
    </svg>
  );
}

function PatientInfoIcon() {
  return (
    <svg className="line-icon" viewBox="0 0 32 28" aria-hidden="true">
      <rect fill="none" x="4.5" y="3.5" width="23" height="21" rx="3" />
      <circle fill="none" cx="11" cy="11" r="3" />
      <path fill="none" d="M6.8 20c.7-3 2.1-4.5 4.2-4.5s3.5 1.5 4.2 4.5M19 10h5m-5 5h5m-5 5h4" />
    </svg>
  );
}

function InspectorAgentIcon({ agentName }) {
  if (agentName === "Cardiology Agent") return <CardiologyIcon />;
  if (agentName === "Orthopedics Agent") return <OrthopedicsIcon />;
  if (agentName === "Room Agents") return <RoomIcon />;
  if (agentName === "Patient Info Agent") return <PatientInfoIcon />;
  return "✦";
}

function PatientInfoPopup({ monitoring = false }) {
  const patientDetails = [
    ["Patient ID", "P-1024"],
    ["Current Department", "Cardiology"],
    ["Transfer To", "Orthopedics"],
  ];
  const medicalHistory = [
    ["Cardiac Conditions", "심부전 · 부정맥"],
    ["Current Diagnosis", "대퇴골 골절"],
    ["Mobility", "독립 보행 불가"],
    ["Transfer Precaution", "심혈관 상태 관찰"],
  ];
  const patientMonitoring = [
    ["Patient ID", "P-1024"],
    ["Cardiac Conditions", "심부전 · 부정맥"],
    ["Monitoring", "HR · SpO₂ · ECG"],
    ["Observation", "심혈관 상태 관찰"],
  ];
  const requiredDevices = [
    ["ECG Monitor", "Required"],
    ["SpO₂ Sensor", "Required"],
    ["Heart Rate Monitor", "Required"],
  ];

  return (
    <aside className="patient-info-popup" aria-label="Patient P-1024 information">
      <header>
        <span className="patient-popup-title"><PatientInfoIcon /><strong>PATIENT INFO</strong></span>
        <span className="patient-popup-id">P-1024</span>
      </header>
      <div className="patient-popup-body">
        <div className="patient-popup-profile">
          <span className="patient-avatar" aria-hidden="true"><PatientInfoIcon /></span>
          <span><strong>Patient P-1024</strong></span>
        </div>
        {monitoring ? (
          <>
            <section>
              <h3>PATIENT MONITORING</h3>
              <dl>{patientMonitoring.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </section>
            <section>
              <h3>REQUIRED DEVICES</h3>
              <dl>{requiredDevices.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </section>
          </>
        ) : (
          <>
            <section>
              <h3>PATIENT DETAILS</h3>
              <dl>{patientDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </section>
            <section>
              <h3>MEDICAL HISTORY</h3>
              <dl>{medicalHistory.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function Network({ query, onPick, onSearch, onSelect }) {
  const [isMounted, setIsMounted] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchGeometry, setSearchGeometry] = useState(null);
  const [motionTime, setMotionTime] = useState(0);
  const searchFormRef = useRef(null);
  const searchTimer = useRef(null);
  const matches = useMemo(
    () => agents.filter((agent) => `${agent.name} ${agent.note}`.toLowerCase().includes(query.toLowerCase())),
    [query]
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    setIsMounted(true);

    let animationFrame;
    let lastUpdate = 0;
    const startedAt = performance.now();

    const animate = (now) => {
      if (now - lastUpdate >= 33) {
        setMotionTime((now - startedAt) / 1000);
        lastUpdate = now;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => () => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
  }, []);

  const startSearch = () => {
    if (isSearching) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onSearch();
      return;
    }

    const rect = searchFormRef.current.getBoundingClientRect();
    const containingRect = searchFormRef.current.closest(".hub-core").getBoundingClientRect();
    const mobile = window.innerWidth <= 640;
    const horizontalPadding = mobile ? 20 : window.innerWidth * .05;
    const toolbarWidth = Math.min(680, window.innerWidth - horizontalPadding * 2);
    const targetLeft = mobile
      ? horizontalPadding + 50
      : (window.innerWidth - toolbarWidth) / 2 + 60;

    setSearchGeometry({
      "--search-start-top": `${rect.top - containingRect.top}px`,
      "--search-start-left": `${rect.left - containingRect.left}px`,
      "--search-start-width": `${rect.width}px`,
      "--search-start-height": `${rect.height}px`,
      "--search-target-top": `${(mobile ? 76 : 86) - containingRect.top}px`,
      "--search-target-left": `${targetLeft - containingRect.left}px`,
      "--search-target-width": `${mobile ? toolbarWidth - 50 : toolbarWidth - 120}px`,
      "--search-target-height": `${mobile ? 46 : 52}px`,
      "--search-target-button": `${mobile ? 36 : 40}px`,
    });
    setIsSearching(true);
    searchTimer.current = window.setTimeout(onSearch, 820);
  };

  const movingAgents = useMemo(() => agents.map((agent, agentIndex) => {
    if (!isMounted) {
      return { ...agent, movingX: agent.x, movingY: agent.y, movingPoints: agent.points };
    }

    const agentPhase = motionTime * .55 + agentIndex * 1.37;
    return {
      ...agent,
      movingX: agent.x + Math.sin(agentPhase) * .9,
      movingY: agent.y + Math.cos(agentPhase * .86) * .7,
      movingPoints: agent.points.map(([x, y], pointIndex) => {
        const pointPhase = motionTime * (.62 + pointIndex * .09) + agentIndex * 1.61 + pointIndex * .83;
        return [x + Math.sin(pointPhase) * 1.65, y + Math.cos(pointPhase * .91) * 1.3];
      }),
    };
  }), [isMounted, motionTime]);

  const movingDots = movingAgents.flatMap((agent) => agent.movingPoints.map(([x, y], pointIndex) => ({
    key: `${agent.id}-${pointIndex}`,
    x,
    y,
  })));

  return (
    <div className={`network ${isSearching ? "is-searching" : ""}`} aria-label="Agent network">
      <svg className="connections" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
        {movingAgents.map((agent) => (
          <line key={`${agent.id}-hub`} className="hub-connection" x1={agent.movingX} y1={agent.movingY} x2="50" y2="53" />
        ))}
        {movingAgents.flatMap((agent) => agent.movingPoints.map(([x, y], pointIndex) => (
          <line key={`${agent.id}-${pointIndex}`} x1={agent.movingX} y1={agent.movingY} x2={x} y2={y} />
        )))}
      </svg>

      {movingDots.map((dot, index) => (
        <span
          key={dot.key}
          className={`connection-dot ${index % 3 === 0 ? "connection-dot-large" : ""}`}
          style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
          aria-hidden="true"
        />
      ))}

      <div className="hub-core">
        <span className="eyebrow">FIND YOUR PERFECT AGENT</span>
        <h1>Agent Hubs</h1>
        <form ref={searchFormRef} className="search" style={searchGeometry || undefined} onSubmit={(event) => { event.preventDefault(); startSearch(); }}>
          <label className="sr-only" htmlFor="agent-search">Search agents</label>
          <input id="agent-search" value={query} onFocus={() => { if (!query) onPick("baby"); }} onChange={(event) => onPick(event.target.value)} placeholder="What do you need help with?" />
          <button type="submit" aria-label="Search" disabled={isSearching}><SearchIcon /></button>
        </form>
        <p>{query ? `${matches.length} agent${matches.length === 1 ? "" : "s"} found in the network` : "Explore a network of agents built around your life."}</p>
      </div>

      {movingAgents.map((agent) => {
        const hidden = query && !matches.some((match) => match.id === agent.id);
        return (
          <button key={agent.id} className={`agent-node label-${agent.labelSide} ${hidden ? "is-muted" : ""}`} style={{ left: `${agent.movingX}%`, top: `${agent.movingY}%` }} onClick={() => onSelect(agent)}>
            <span className="agent-symbol">{agent.icon}</span>
            <span className="agent-copy"><strong>{agent.name}</strong><small>{agent.note}</small></span>
          </button>
        );
      })}

    </div>
  );
}

function SearchResults({ query, onPick, onSearch, onBack }) {
  const [carouselStep, setCarouselStep] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const visibleResults = Array.from({ length: 6 }, (_, index) => babyResults[(carouselStep + index) % babyResults.length]);

  const showNextResult = () => {
    if (!isSliding) setIsSliding(true);
  };

  const finishSlide = (event) => {
    if (event.target !== event.currentTarget) return;
    if (!isSliding) return;
    setCarouselStep((current) => current + 1);
    setIsSliding(false);
  };

  return (
    <main className="search-results">
      <div className="results-toolbar">
        <button className="results-back" type="button" onClick={onBack} aria-label="Back to Agent Hub">←</button>
        <form className="results-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <label className="sr-only" htmlFor="results-agent-search">Search agents</label>
          <input id="results-agent-search" value={query} onChange={(event) => onPick(event.target.value)} />
          <button type="submit" aria-label="Search"><SearchIcon /></button>
        </form>
      </div>

      <div className="results-heading">
        <span className="eyebrow">SEARCH RESULTS</span>
        <h1>Agents for “{query || "baby"}”</h1>
      </div>

      <section className="result-carousel" aria-label="Baby agent search results" aria-roledescription="carousel">
        <div className={`carousel-track ${isSliding ? "is-sliding" : ""}`} onTransitionEnd={finishSlide}>
          {visibleResults.map((result, index) => (
            <div key={`${carouselStep}-${index}-${result.name}`} className="carousel-card" aria-hidden={index === 5}>
              <article className="result-card">
                <span className="result-symbol" aria-hidden="true">✦</span>
                <h2>{result.name}</h2>
                <p>{result.note}</p>
                <ul>
                  {result.features.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
              </article>
            </div>
          ))}
        </div>
      </section>

      <button className="results-next" type="button" onClick={showNextResult} disabled={isSliding} aria-label="Show next agent cards">→</button>
    </main>
  );
}

function AgentDetail({ agent, onBack, isPlaying, onPlay, onExitPlay }) {
  const [simulationStep, setSimulationStep] = useState(1);
  const [isDeviceCheckReady, setIsDeviceCheckReady] = useState(false);
  const positions = agent.id === "health" ? hospitalTopicPositions : topicPositions;
  const topics = agentTopics[agent.id].map((label, index) => ({ label, x: positions[index][0], y: positions[index][1] }));
  const stepDetails = simulationSteps[simulationStep - 1];
  const nodePositions = {
    hospital: { x: 50, y: 38 },
    cardiology: topics[0],
    orthopedics: topics[1],
    room: topics[2],
    patientInfo: topics[3],
  };
  const particleStart = nodePositions[stepDetails.from];
  const particleEnd = nodePositions[stepDetails.to];
  const isPatientHospitalTransfer = [stepDetails.from, stepDetails.to].includes("hospital")
    && [stepDetails.from, stepDetails.to].includes("patientInfo");
  const isGrayTransfer = simulationStep === 6;
  const connectionDistance = Math.hypot(particleEnd.x - particleStart.x, particleEnd.y - particleStart.y);
  const particleDuration = connectionDistance <= 40 ? "1.3s" : "1.5s";
  const hospitalLabelAbove = (stepDetails.from === "hospital" && particleEnd.y > 38)
    || (stepDetails.to === "hospital" && particleStart.y > 38);
  const displayedPayload = simulationStep === 7 && !isDeviceCheckReady
    ? [["Room", "302"], ["ECG Monitor", "Not Connected"], ["SpO₂ Sensor", "Not Connected"], ["Heart Rate", "Non-operational"]]
    : stepDetails.payload;

  useEffect(() => {
    if (!isPlaying) setSimulationStep(1);
  }, [isPlaying]);

  useEffect(() => {
    if (simulationStep !== 7) {
      setIsDeviceCheckReady(false);
      return undefined;
    }

    const readyTimer = window.setTimeout(() => setIsDeviceCheckReady(true), 2000);
    return () => window.clearTimeout(readyTimer);
  }, [simulationStep]);

  return (
    <main className={`agent-detail ${isPlaying ? "is-playing" : ""}`}>
      <div className={`detail-bar ${isPlaying ? "is-playing" : ""}`}>
        <button className="detail-back" onClick={isPlaying ? onExitPlay : onBack}><span>←</span> {isPlaying ? "Back" : "Agent Hub"}</button>
        {!isPlaying && <span className="detail-title" aria-hidden="true" />}
        {!isPlaying && (
          <button className="detail-launch" onClick={agent.id === "health" ? onPlay : undefined} aria-label={`${agent.id === "health" ? "Play" : "Open"} ${agent.name}`}>
            {agent.id === "health" ? <PlayIcon /> : "↗"}
          </button>
        )}
      </div>

      {isPlaying && (
        <aside className="communication-card" aria-label="Message inspector dashboard">
          <div className="inspector-header">
            <span className="inspector-heading">
              <span className={`inspector-icon ${stepDetails.sender === "Hospital Agent" ? "inspector-star" : ""}`}>
                <InspectorAgentIcon agentName={stepDetails.sender} />
              </span>
              <strong>{stepDetails.sender}</strong>
            </span>
            <span className="inspector-step-count">STEP {String(simulationStep).padStart(2, "0")} / 10</span>
          </div>

          <div className="inspector-content">
            <div className="inspector-task-row">
              <strong className="inspector-task">{stepDetails.task}</strong>
              <span>{stepDetails.description}</span>
            </div>

            <div className="payload-heading">
              <strong>PAYLOAD</strong>
            </div>
            <dl className="payload-list">
              {displayedPayload.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </div>

          <div className="inspector-footer">
            <button type="button" className="inspector-prev" disabled={simulationStep === 1} onClick={() => setSimulationStep((step) => Math.max(1, step - 1))}><span>‹</span> Prev</button>
            <div className="inspector-progress" aria-label={`Step ${simulationStep} of 10`}>
              {Array.from({ length: 10 }, (_, index) => <i key={index} className={index === simulationStep - 1 ? "active" : ""} />)}
            </div>
            <button type="button" className="inspector-next" aria-label="Next step" disabled={simulationStep === 10 || (simulationStep === 7 && !isDeviceCheckReady)} onClick={() => setSimulationStep((step) => Math.min(10, step + 1))}>Next <span>›</span></button>
          </div>
        </aside>
      )}

      <div className="detail-network" aria-label={`${agent.name} capabilities`}>
        <svg className="detail-connections" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
          {topics.map((topic) => (
            <line
              key={topic.label}
              x1="50"
              y1="38"
              x2={topic.x}
              y2={topic.y}
            />
          ))}
          {isPlaying && !stepDetails.internal && (
            <line
              className={`active-transfer-line ${isPatientHospitalTransfer ? "bidirectional-transfer-line" : ""} ${isGrayTransfer ? "gray-transfer-line" : ""}`}
              x1={particleStart.x}
              y1={particleStart.y}
              x2={particleEnd.x}
              y2={particleEnd.y}
            />
          )}
        </svg>

        {isPlaying && agent.id === "health" && !stepDetails.internal && [
          "cubic-bezier(.25,.5,.65,.85)",
          "linear",
          "cubic-bezier(.35,.15,.75,.5)",
        ].flatMap((speedCurve, particle) => {
          const particleStyle = {
            "--particle-start-x": `${particleStart.x}%`,
            "--particle-start-y": `${particleStart.y}%`,
            "--particle-end-x": `${particleEnd.x}%`,
            "--particle-end-y": `${particleEnd.y}%`,
            "--particle-duration": particleDuration,
            "--particle-speed-curve": speedCurve,
          };

          if (isPatientHospitalTransfer) {
            return [
              <span key={`${simulationStep}-forward-${particle}`} className="transfer-particle transfer-particle-forward" style={particleStyle} aria-hidden="true" />,
              <span key={`${simulationStep}-reverse-${particle}`} className="transfer-particle transfer-particle-reverse" style={particleStyle} aria-hidden="true" />,
            ];
          }

          return <span key={`${simulationStep}-${particle}`} className={`transfer-particle ${isGrayTransfer ? "transfer-particle-gray" : ""}`} style={particleStyle} aria-hidden="true" />;
        })}

        <div className={`detail-center ${agent.id === "health" ? "hospital-detail-center" : ""} ${hospitalLabelAbove ? "hospital-label-above" : ""}`}>
          <span className="detail-star">✦</span>
          <strong>{agent.name}</strong>
          {agent.id !== "health" && <small>{agent.note}</small>}
        </div>

        {topics.map((topic) => (
          <div key={topic.label} className={`detail-node ${topic.x > 50 ? "detail-node-left" : "detail-node-right"} ${agent.id === "health" ? "hospital-detail-node" : ""} ${agent.id === "health" && topic.y < 50 ? "hospital-node-top" : ""} ${topic.label === "Patient Info Agent" ? "patient-info-node" : ""} ${stepDetails.internal && topic.label === "Room Agents" ? (isDeviceCheckReady ? "internal-step-node" : "room-node-loading") : ""}`} style={{ left: `${topic.x}%`, top: `${topic.y}%` }}>
            <span className="detail-dot" />
            <strong>{topic.label === "Patient Info Agent" ? <>Patient Info<br />Agent</> : topic.label}</strong>
          </div>
        ))}

        {isPlaying && [2, 5, 6].includes(simulationStep) && (
          <PatientInfoPopup monitoring={simulationStep === 5 || simulationStep === 6} />
        )}
      </div>
    </main>
  );
}

function MyAgentsPage({ onSelect }) {
  return (
    <main className="my-agents" aria-label="My agents">
      <header className="my-agents-heading">
        <span className="eyebrow">YOUR ACTIVE NETWORK</span>
        <h1>Agents in use</h1>
        <p>Agents currently connected to your everyday routines.</p>
      </header>
      <div className="my-agents-grid">
        {agents.map((agent) => (
          <button key={agent.id} className="my-agent-card" onClick={() => onSelect(agent)}>
            <span className="my-agent-card-top">
              <span className="my-agent-symbol" aria-hidden="true">{agent.icon}</span>
              <span className="my-agent-status"><i />Online</span>
            </span>
            <span className="my-agent-name">{agent.name}</span>
            <span className="my-agent-note">{agent.note}</span>
            <span className="my-agent-meta">
              <span>{agentTopics[agent.id].length} connections</span>
              <span aria-hidden="true">↗</span>
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}

function AgentStudioPage() {
  const [prompt, setPrompt] = useState("");

  return (
    <main className="network studio-network" aria-label="Agent Studio">
      <div className="hub-core studio-core">
        <span className="eyebrow">DESIGN YOUR PERFECT AGENT</span>
        <h1>Agent Studio</h1>
        <form className="search" onSubmit={(event) => event.preventDefault()}>
          <label className="sr-only" htmlFor="studio-prompt">Describe the agent you want to create</label>
          <input
            id="studio-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What kind of agent do you want to create?"
          />
          <button type="submit" aria-label="Start creating"><SearchIcon /></button>
        </form>
        <p>Create an agent built around your ideas.</p>
      </div>
    </main>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("Agent Hub");
  const [query, setQuery] = useState("");
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isAgentPlaying, setIsAgentPlaying] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const applyRouteState = (routeState) => {
    setActiveTab(routeState.activeTab);
    setQuery(routeState.query);
    setSelectedAgent(routeState.selectedAgent);
    setIsAgentPlaying(routeState.isAgentPlaying);
    setShowResults(routeState.showResults);
  };

  const navigate = (route, { replace = false } = {}) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";

    if (route.tab && tabRouteNames[route.tab]) url.searchParams.set("tab", tabRouteNames[route.tab]);
    if (route.view === "search") {
      url.searchParams.set("view", "search");
      url.searchParams.set("q", route.query || "baby");
    }
    if (route.agent) {
      url.searchParams.set("agent", route.agent.id);
      if (route.play) url.searchParams.set("mode", "play");
    }

    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    applyRouteState(readRouteState());
  };

  useEffect(() => {
    const syncFromUrl = () => applyRouteState(readRouteState());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const changeTab = (tab) => {
    navigate(tab === "Agent Hub" ? {} : { tab });
  };

  return (
    <div className={`site-shell ${isAgentPlaying ? "is-immersive" : ""}`}>
      {!isAgentPlaying && <header className="header">
        <nav aria-label="Main navigation">
          {tabs.map((tab) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => changeTab(tab)}>
              {tab === "Agent Hub" && selectedAgent
                ? <span className="tab-breadcrumb"><span>Agent Hub</span><span aria-hidden="true">&gt;</span><span>{selectedAgent.name}</span></span>
                : tab}
            </button>
          ))}
        </nav>
      </header>}
      {activeTab === "Agent Hub"
        ? selectedAgent
          ? <AgentDetail agent={selectedAgent} isPlaying={isAgentPlaying} onPlay={() => navigate({ agent: selectedAgent, play: true })} onExitPlay={() => navigate({ agent: selectedAgent })} onBack={() => navigate({})} />
          : showResults
            ? <SearchResults query={query} onPick={(value) => navigate({ view: "search", query: value }, { replace: true })} onSearch={() => navigate({ view: "search", query }, { replace: true })} onBack={() => navigate({})} />
            : <Network query={query} onPick={setQuery} onSearch={() => navigate({ view: "search", query })} onSelect={(agent) => navigate({ agent })} />
        : activeTab === "Agent Studio"
          ? <AgentStudioPage />
          : <MyAgentsPage onSelect={(agent) => navigate({ agent })} />}
      {!isAgentPlaying && <footer><span>AGENT HUB / 2026</span><span>Human needs, intelligent connections.</span></footer>}
    </div>
  );
}
