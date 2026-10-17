from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from ambient.a2a_codec import from_parts, to_message
from ambient.context_store import ContextStore
from ambient.schemas import (
    ContextSubscribe,
    ContextUpdate,
    ControlResult,
    DeviceAction,
    DeviceControl,
    ReasonCode,
    parse_message,
)
from ambient.subscriptions import SubscriptionRegistry

NOW = datetime(2026, 10, 16, 5, 0, tzinfo=UTC)


def update(seq: str, minutes: int = 10, **data) -> ContextUpdate:
    return ContextUpdate(
        source="desktop-user1",
        subject="user1",
        sequence=seq,
        expires_at=NOW + timedelta(minutes=minutes),
        data=data or {"meeting_app_active": True},
    )


def test_parse_dispatches_on_type():
    msg = parse_message(update("1").model_dump(mode="json"))
    assert isinstance(msg, ContextUpdate)


def test_sequence_must_be_digit_string():
    with pytest.raises(ValidationError):
        update("1.0")


def test_store_ignores_expired_and_older():
    store = ContextStore()
    assert store.accept(update("2"), NOW)
    assert not store.accept(update("1"), NOW)  # older
    assert not store.accept(update("2"), NOW)  # same
    assert not store.accept(update("3", minutes=-1), NOW)  # expired
    assert store.get("desktop-user1", "user1", NOW).seq == 2
    assert store.get("desktop-user1", "user1", NOW + timedelta(minutes=11)) is None


def test_subscription_filters_fields_and_expires():
    reg = SubscriptionRegistry()
    req = ContextSubscribe(
        requester="my-room-user1", subject="user1",
        fields=["meeting_app_active", "pc_state", "calendar_title"], ttl_seconds="60",
    )
    result = reg.subscribe(req, allowed_fields={"meeting_app_active", "pc_state"}, now=NOW)
    assert result.rejected_fields == ["calendar_title"]
    expected = [("my-room-user1", frozenset({"pc_state"}))]
    assert reg.recipients("user1", ["pc_state"], NOW) == expected
    assert reg.recipients("user1", ["pc_state"], NOW + timedelta(seconds=61)) == []


def test_codec_roundtrip_through_a2a_message():
    ctrl = DeviceControl(
        request_id="req-001", requester="home-agent", target="baby-room-agent",
        action=DeviceAction(device="baby_room_ac", command="TURN_OFF"),
        reason_code=ReasonCode.ENERGY_SAVING,
    )
    assert from_parts(to_message(ctrl).parts) == ctrl
    res = ControlResult(request_id="req-001", accepted=False, reason_code=ReasonCode.SAFETY_POLICY)
    assert from_parts(to_message(res).parts) == res
