**관련 이슈**: #

**변경 내용**

**확인**
- [ ] 바꾼 폴더의 테스트 통과 (`services/`: `pytest`, `ruff check .` / `frontend/`: `npm run build`)
- [ ] `services/collector/`의 events·flows·agents나 `services/gateway/stream.py`를 바꿨다면 `python scripts/export_schemas.py` 실행
- [ ] 기기 ID를 바꿨다면 `homeassistant/`와 `services/config/devices.yaml`을 함께 고침
