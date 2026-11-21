from common.agentcard import CardTags, card_tags


def test_reads_role_space_devices_and_fields_from_skill_tags():
    card = {
        "skills": [
            {"id": "device.control", "tags": ["room", "space:my_room", "device:input_boolean.a"]},
            {"id": "other", "tags": ["room", "device:input_boolean.b", "field:presence"]},
        ]
    }
    assert card_tags(card) == CardTags(
        role="room",
        space="my_room",
        owned_devices=["input_boolean.a", "input_boolean.b"],
        provided_fields=["presence"],
    )


def test_extensions_are_not_read():
    params = {"role": "room", "owned_devices": ["input_boolean.a"]}
    card = {"capabilities": {"extensions": [{"uri": "x", "params": params}]}, "skills": [{}]}
    assert card_tags(card) == CardTags()


def test_a_plain_a2a_card_owns_nothing():
    assert card_tags({"name": "weather", "skills": [{"id": "forecast", "tags": ["weather"]}]}) == (
        CardTags()
    )
    assert card_tags({"skills": "nope"}) == CardTags()
