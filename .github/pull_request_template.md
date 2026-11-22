**관련 이슈**: #

**변경 내용**

**확인**
- [ ] 바꾼 폴더의 테스트 통과 (`services/`: `pytest`, `ruff check .` / `agents/home-a2a-plugin/`: `pnpm test`)
- [ ] `services/collector/events.py`나 `services/gateway/stream.py`를 바꿨다면 `python scripts/export_schemas.py` 실행
- [ ] 기기·에이전트 ID를 바꿨다면 에이전트 `owned`, `agents/**/AGENTS.md`, `services/config/devices.yaml`을 함께 고침
- [ ] `docker compose up -d --build`로 전체가 뜨는지 확인
