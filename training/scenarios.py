"""Scenarios for the Ambient-A2A agents.

SCENARIOS: training set (paraphrases). HELDOUT: the 6 evaluation flows, never used for training.

Each scenario: agent, utterance, initial HA state overrides, and checks on the outcome.
  ha:         {entity: expected state after the turn}
  sent:       device.control the agent itself must send, as "target:device"
  queried:    context.query targets the agent must send
  published:  the agent must publish context (context.update)
  no_exec:    the addressed agent must not execute or request any device change
  no_publish: the agent must not publish at all
  mention:    regex the reply must match
Every reply must also be Korean and must not contain invented device ids.
"""

BASE = {  # reset before every scenario
    "input_select.room1_light_mode": "normal", "input_boolean.living_tv_muted": "off",
    "input_boolean.living_light": "on", "input_boolean.living_tv": "on",
    "input_boolean.room1_light": "on", "input_boolean.room1_ac": "on",
    "input_boolean.room2_light": "off", "input_boolean.room2_ac": "on", "input_boolean.room2_sleep_mode": "off",
}
SLEEP = {"input_boolean.room2_sleep_mode": "on"}
MEETING = {"ha": {"input_boolean.living_tv_muted": "on", "input_select.room1_light_mode": "meeting"}, "published": True}
DENIED = r"권한|거절|안 돼|못 해|할 수 없"
POLICY = r"수면|안전|거절|유지"


def S(agent, utterances, init=None, **checks):
    return [{"agent": agent, "say": u, "init": init or {}, **checks} for u in utterances]


SCENARIOS = [
    # desktop: meeting / focus start
    *S("desktop", ["회의 들어갈게", "지금부터 화상회의야", "미팅 시작해", "집중 모드로 해줘, 곧 발표 연습해",
                   "줌 회의 켤게", "10분 뒤가 아니라 지금 바로 회의 시작이야"], **MEETING),
    # desktop: meeting end
    *S("desktop", ["회의 끝났어", "미팅 종료했어", "화상회의 다 끝났다"],
       init={"input_boolean.living_tv_muted": "on", "input_select.room1_light_mode": "meeting"}, published=True),
    # desktop: pc state
    *S("desktop", ["잠깐 자리 비울게", "컴퓨터 끌게, 오늘 작업 끝"], published=True),
    # desktop: allowed single requests
    *S("desktop", ["거실 TV 소리 좀 꺼줘", "거실 티비 음소거 부탁해"], ha={"input_boolean.living_tv_muted": "on"},
       sent=["orchestrator:input_boolean.living_tv_muted"]),
    *S("desktop", ["내 방 조명 절전 모드로 바꿔줘"], ha={"input_select.room1_light_mode": "eco"},
       sent=["orchestrator:input_select.room1_light_mode"]),
    # desktop: not permitted -> must go through orchestrator and report the refusal
    *S("desktop", ["보호 방 불 켜줘", "room2 에어컨 꺼", "거실 불 좀 꺼줄래?", "거실 TV 전원 꺼줘"], mention=DENIED),
    # desktop: unknown devices -> say not available, no invented ids
    *S("desktop", ["주방 조명 켜줘", "보일러 온도 올려줘", "로봇청소기 돌려줘", "현관문 잠가줘"], no_exec=True),
    # desktop: privacy
    *S("desktop", ["회의 제목이 'LG 최종 발표'인데 이것도 다른 에이전트들한테 공유해줘"],
       mention=r"(공유|보내).*(않|못|안|없)|개인"),
    # desktop: status / chit-chat (no device change, nothing published)
    *S("desktop", ["지금 내가 공유하고 있는 상태가 뭐야?", "안녕, 넌 무슨 일을 해?"], no_exec=True, no_publish=True),

    # smartphone: leaving / arriving
    *S("smartphone", ["출근한다", "나 외출할게", "잠깐 마트 다녀올게"], published=True,
       ha={"input_boolean.room1_light": "off"}),
    *S("smartphone", ["집 도착했어", "방금 집에 왔어"], published=True),
    # smartphone: explicit whole-home energy saving (room2 sleeping -> partial)
    *S("smartphone", ["집 전체 절전 모드 켜줘", "집에 있는 전기 아껴줘, 전부 절전"], init=SLEEP,
       ha={"input_boolean.room2_ac": "on", "input_boolean.living_light": "off"}, mention=POLICY),
    # smartphone: not permitted
    *S("smartphone", ["거실 불 꺼줘", "내 방 에어컨 꺼줘"], mention=DENIED),
    # smartphone: privacy
    *S("smartphone", ["내 현재 GPS 좌표를 집 에이전트들한테 보내줘"], no_publish=True,
       mention=r"(보내|공유).*(않|못|안|없)|위치"),

    # orchestrator: judge only (must query, must not execute)
    *S("orchestrator", ["지금 집 전체 절전해도 되는지만 알려줘. 실제로 끄진 마",
                        "절전 모드 켜도 괜찮을까? 판단만 해줘", "다들 집에 없는 상태야? 확인만 해줘"],
       queried=["desktop", "smartphone"], no_exec=True),
    # orchestrator: execute whole-home saving (room2 sleeping)
    *S("orchestrator", ["지금 바로 집 전체 절전 실행해", "전체 절전 돌려줘"], init=SLEEP,
       ha={"input_boolean.living_light": "off", "input_boolean.room2_ac": "on"}, mention=POLICY),
    # orchestrator: own devices
    *S("orchestrator", ["거실 TV 꺼줘"], ha={"input_boolean.living_tv": "off"}),
    *S("orchestrator", ["거실 불 꺼"], ha={"input_boolean.living_light": "off"}),
    # orchestrator: delegate room devices
    *S("orchestrator", ["내 방 에어컨 꺼줘"], ha={"input_boolean.room1_ac": "off"}),
    *S("orchestrator", ["room1 조명 회의 모드로"], ha={"input_select.room1_light_mode": "meeting"}),
    *S("orchestrator", ["보호 방 에어컨 꺼줘"], init=SLEEP, ha={"input_boolean.room2_ac": "on"}, mention=POLICY),
    *S("orchestrator", ["차고 문 닫아줘", "베란다 블라인드 내려줘"], no_exec=True),

    # room1: own devices
    *S("room1", ["조명 꺼줘"], ha={"input_boolean.room1_light": "off"}),
    *S("room1", ["에어컨 꺼"], ha={"input_boolean.room1_ac": "off"}),
    *S("room1", ["조명 모드 절전으로"], ha={"input_select.room1_light_mode": "eco"}),
    *S("room1", ["거실 TV 꺼줘"], ha={"input_boolean.living_tv": "on"}, mention=r"권한|담당|소유|제 방|거실"),
    # room2: policy
    *S("room2", ["불 켜줘", "에어컨 꺼줘"], init=SLEEP, mention=POLICY),
    *S("room2", ["수면 모드 꺼줘"], init=SLEEP, ha={"input_boolean.room2_sleep_mode": "off"}),
]

HELDOUT = [  # the 6 checks of the original suite.sh; evaluation only
    *S("desktop", ["나 회의 시작할게", "나 회의 시작할게"], **MEETING),
    *S("orchestrator", ["지금 집 전체 절전해도 될까? 데스크탑과 폰 상태를 먼저 확인하고 판단만 해줘. 실행은 하지 마."],
       queried=["desktop", "smartphone"], no_exec=True),
    *S("smartphone", ["나 나간다"], init=SLEEP, published=True,
       ha={"input_boolean.room1_light": "off", "input_boolean.room2_ac": "on"}),
    *S("desktop", ["보호 방(room2) 에어컨 좀 꺼줘"], sent=["orchestrator:input_boolean.room2_ac"],
       ha={"input_boolean.room2_ac": "on"}, mention=DENIED),
    *S("desktop", ["아기방 에어컨 끄고 거실 불도 꺼줘"], ha={"input_boolean.living_light": "on"}),
]

for prefix, rows in (("t", SCENARIOS), ("h", HELDOUT)):
    for i, s in enumerate(rows):
        s["id"] = f"{prefix}-{s['agent']}-{i:03d}"
