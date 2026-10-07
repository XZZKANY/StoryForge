from __future__ import annotations

import pytest

from app.domains.agent_runs.patches import evaluate_polish_candidate
from app.domains.agent_runs.patches.polish_fact_guards import grounded_fact_contradictions

FORWARD = "林岚把铜钥匙交给顾迟。"
REVERSE = "顾迟把铜钥匙交给林岚。"
NEGATED = "林岚没有把铜钥匙交给顾迟。"
ENTITIES = ("林岚", "顾迟")


@pytest.mark.parametrize(
    "original,candidate",
    [
        pytest.param(FORWARD + REVERSE, FORWARD + REVERSE, id="unchanged-reciprocal"),
        pytest.param(
            FORWARD + REVERSE,
            (FORWARD + REVERSE).replace("交给", "递给"),
            id="reciprocal-wording",
        ),
        pytest.param(FORWARD + NEGATED, FORWARD + NEGATED, id="unchanged-both-polarities"),
        pytest.param(
            FORWARD + NEGATED,
            (FORWARD + NEGATED).replace("交给", "送给"),
            id="both-polarities-wording",
        ),
        pytest.param(FORWARD, FORWARD.replace("交给", "递给"), id="same-event-wording"),
    ],
)
def test_existing_transfer_relations_are_not_new_contradictions(original, candidate):
    result = evaluate_polish_candidate(original, candidate, protected_entities=ENTITIES)

    assert result.passed, result.reasons
    assert "event_relation_changed" not in result.reasons


@pytest.mark.parametrize(
    "original,candidate,contradicted",
    [
        pytest.param(FORWARD, REVERSE, True, id="reversed-roles"),
        pytest.param(FORWARD, NEGATED, True, id="new-negation"),
        pytest.param(NEGATED, FORWARD, True, id="removed-negation"),
        pytest.param(FORWARD, FORWARD + REVERSE, True, id="added-reverse"),
        pytest.param(FORWARD, FORWARD + NEGATED, True, id="added-negation"),
        pytest.param(
            FORWARD + REVERSE + FORWARD.replace("铜", "银"),
            FORWARD + REVERSE + REVERSE.replace("铜", "银"),
            True,
            id="existing-reciprocal-does-not-hide-another-reversal",
        ),
        pytest.param(FORWARD + NEGATED, FORWARD + NEGATED + REVERSE, True, id="existing-polarities-new-reverse"),
        pytest.param(FORWARD, REVERSE.replace("铜", "银"), False, id="different-object"),
        pytest.param(FORWARD, "她以为" + REVERSE, False, id="hypothetical-reverse"),
        pytest.param(FORWARD, "“" + REVERSE + "”", False, id="dialogue-reverse"),
        pytest.param(FORWARD + "“" + REVERSE + "”", REVERSE, True, id="dialogue-is-not-original-evidence"),
        pytest.param(FORWARD, FORWARD.replace("顾迟", "林岚"), False, id="self-transfer-is-not-role-reversal"),
    ],
)
def test_only_new_grounded_transfer_contradictions_are_rejected(original, candidate, contradicted):
    reasons = grounded_fact_contradictions(original, candidate, entities=ENTITIES, facts=())

    assert reasons == (("event_relation_changed",) if contradicted else ())
