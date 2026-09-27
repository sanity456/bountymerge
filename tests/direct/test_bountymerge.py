"""Direct GenLayer tests for immutable requests and two-owner merge state."""
import json
import pytest


def addr(value):
    return str(value).lower()


def candidate(status="MERGEABLE"):
    if status == "MERGEABLE":
        return {"status": status, "reason": "Both requests need a CSV export of wallet activity with dates and token amounts.",
                "brief_lines": ["Export wallet transactions as CSV with dates, amounts and tokens.",
                                "Let users choose a date range and exclude private notes."],
                "coverage_a": [0, 1], "coverage_b": [0, 0]}
    return {"status": status, "reason": "A live balance integration requires continuous updates; a CSV download is a one-time export.",
            "brief_lines": [], "coverage_a": [], "coverage_b": []}


@pytest.fixture
def board(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/bountymerge.py")
    contract.create_project("Wallet Tools", "Shared feature requests for a wallet product.")
    project_id = contract.list_projects(0, 20)["items"][0]["id"]
    contract.submit_request(project_id, "CSV history", "Download wallet history for bookkeeping.",
                            json.dumps(["Include dates and token amounts.", "Choose a date range."]),
                            json.dumps(["Exclude private notes."]))
    first = contract.list_requests(project_id, 0, 20)["items"][0]["id"]
    direct_vm.sender = direct_bob
    contract.submit_request(project_id, "Excel export", "Open wallet activity in Excel.",
                            json.dumps(["Provide a CSV file for Excel.", "Include dates and token amounts."]), "[]")
    second = contract.list_requests(project_id, 0, 20)["items"][1]["id"]
    return contract, project_id, first, second


def compare(contract, vm, first, second, status="MERGEABLE"):
    vm.clear_mocks()
    vm.mock_llm("^BOUNTYMERGE_COMPARE_V1", json.dumps(candidate(status)))
    contract.compare_requests(first, second)
    project = contract.get_request(first)["project_id"]
    return contract.list_comparisons(project, 0, 20)["items"][-1]["id"]


def test_two_owners_can_approve_and_originals_survive(board, direct_vm, direct_alice, direct_bob, direct_charlie):
    contract, project, first, second = board
    direct_vm.sender = direct_charlie
    comparison_id = compare(contract, direct_vm, first, second)
    comparison = contract.get_comparison(comparison_id)
    assert comparison["result"]["status"] == "MERGEABLE"
    assert comparison["state"] == "AWAITING_APPROVAL"
    with direct_vm.expect_revert("ONLY_REQUEST_OWNERS"):
        contract.set_approval(comparison_id, True)
    direct_vm.sender = direct_alice
    contract.set_approval(comparison_id, True)
    assert contract.get_comparison(comparison_id)["state"] == "AWAITING_APPROVAL"
    contract.set_approval(comparison_id, False)
    assert contract.get_comparison(comparison_id)["approved_a"] is False
    direct_vm.sender = direct_bob
    contract.set_approval(comparison_id, True)
    assert contract.get_comparison(comparison_id)["state"] == "AWAITING_APPROVAL"
    direct_vm.sender = direct_alice
    contract.set_approval(comparison_id, True)
    assert contract.get_comparison(comparison_id)["state"] == "MERGED"
    assert contract.get_request(first)["merged_into"] == comparison_id
    assert contract.get_request(second)["merged_into"] == comparison_id
    assert contract.get_request(first)["requirements"] == ["Include dates and token amounts.", "Choose a date range."]
    with direct_vm.expect_revert("APPROVAL_CLOSED"):
        contract.set_approval(comparison_id, False)
    with direct_vm.expect_revert("REQUEST_ALREADY_MERGED"):
        contract.compare_requests(first, second)


def test_rejected_round_remains_and_new_round_is_possible(board, direct_vm, direct_alice, direct_bob):
    contract, project, first, second = board
    direct_vm.sender = direct_alice
    old_id = compare(contract, direct_vm, first, second)
    contract.reject_comparison(old_id)
    assert contract.get_comparison(old_id)["state"] == "REJECTED"
    direct_vm.sender = direct_bob
    new_id = compare(contract, direct_vm, second, first)
    assert new_id != old_id
    assert contract.get_comparison(new_id)["round"] == 1
    assert contract.get_comparison(old_id)["state"] == "REJECTED"


def test_closed_unclear_pair_can_be_rescreened(board, direct_vm, direct_alice):
    contract, _, first, second = board
    direct_vm.sender = direct_alice
    old_id = compare(contract, direct_vm, first, second, "UNCLEAR")
    assert contract.get_comparison(old_id)["state"] == "CLOSED"
    new_id = compare(contract, direct_vm, first, second, "MERGEABLE")
    assert new_id != old_id
    assert contract.get_comparison(old_id)["state"] == "CLOSED"
    assert contract.get_comparison(new_id)["round"] == 1
    assert contract.get_comparison(new_id)["state"] == "AWAITING_APPROVAL"


def test_request_has_only_one_active_comparison(board, direct_vm, direct_alice, direct_bob, direct_charlie):
    contract, project, first, second = board
    direct_vm.sender = direct_charlie
    contract.submit_request(project, "Third CSV request", "Another owner wants a CSV export.",
                            json.dumps(["Provide a CSV file for Excel.", "Include dates and token amounts."]), "[]")
    third = contract.list_requests(project, 0, 20)["items"][2]["id"]
    pending_id = compare(contract, direct_vm, first, second)
    with direct_vm.expect_revert("REQUEST_HAS_PENDING_COMPARISON"):
        compare(contract, direct_vm, first, third)
    direct_vm.sender = direct_alice
    contract.reject_comparison(pending_id)
    direct_vm.sender = direct_charlie
    next_id = compare(contract, direct_vm, first, third)
    assert contract.get_comparison(next_id)["state"] == "AWAITING_APPROVAL"
    direct_vm.sender = direct_alice
    contract.set_approval(next_id, True)
    direct_vm.sender = direct_charlie
    contract.set_approval(next_id, True)
    assert contract.get_comparison(next_id)["state"] == "MERGED"
    assert first not in contract.active_comparison
    assert third not in contract.active_comparison


def test_separate_result_has_no_approval_path(board, direct_vm, direct_alice):
    contract, _, first, second = board
    direct_vm.sender = direct_alice
    comparison_id = compare(contract, direct_vm, first, second, "SEPARATE")
    assert contract.get_comparison(comparison_id)["state"] == "CLOSED"
    with direct_vm.expect_revert("APPROVAL_CLOSED"):
        contract.set_approval(comparison_id, True)


def test_submission_guards(board, direct_vm, direct_alice, direct_bob, direct_charlie):
    contract, project, first, second = board
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("IDENTICAL_REQUEST_EXISTS"):
        contract.submit_request(project, "CSV history", "Download wallet history for bookkeeping.",
                                json.dumps(["Include dates and token amounts.", "Choose a date range."]),
                                json.dumps(["Exclude private notes."]))
    with direct_vm.expect_revert("DUPLICATE_LIST_ITEM"):
        contract.submit_request(project, "Duplicate", "A request with a duplicate requirement.",
                                json.dumps(["Keep dates.", "keep dates."]), "[]")
    with direct_vm.expect_revert("SAME_REQUEST"):
        contract.compare_requests(first, first)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("REQUEST_NOT_FOUND"):
        contract.compare_requests(first, "missing")
    direct_vm.sender = direct_bob
    comparison_id = compare(contract, direct_vm, first, second)
    with direct_vm.expect_revert("PAIR_ALREADY_COMPARED"):
        contract.compare_requests(second, first)
    assert contract.get_comparison(comparison_id)["found"] is True


@pytest.mark.parametrize("audit", [
    {"reason_supported": True, "coverage_a": [True, False], "coverage_b": [True, True], "exclusions_supported": True},
    {"reason_supported": True, "coverage_a": [True, True], "coverage_b": [True, True], "exclusions_supported": False},
    {"reason_supported": False, "coverage_a": [True, True], "coverage_b": [True, True], "exclusions_supported": True},
])
def test_validator_rejects_unpreserved_requirement_or_exclusion(board, direct_vm, direct_alice, audit):
    contract, _, first, second = board
    direct_vm.sender = direct_alice
    compare(contract, direct_vm, first, second)
    direct_vm.mock_llm("^BOUNTYMERGE_AUDIT_V1", json.dumps(audit))
    assert direct_vm.run_validator() is False


def test_validator_rejects_status_disagreement(board, direct_vm, direct_alice):
    contract, _, first, second = board
    direct_vm.sender = direct_alice
    compare(contract, direct_vm, first, second)
    direct_vm.mock_llm("^BOUNTYMERGE_COMPARE_V1", json.dumps(candidate("SEPARATE")))
    assert direct_vm.run_validator() is False


@pytest.mark.parametrize("coverage_a,coverage_b", [([1, 1], [1, 1]), ([True, 1], [True, True])])
def test_validator_rejects_non_boolean_coverage(board, direct_vm, direct_alice, coverage_a, coverage_b):
    contract, _, first, second = board
    direct_vm.sender = direct_alice
    compare(contract, direct_vm, first, second)
    direct_vm.mock_llm("^BOUNTYMERGE_AUDIT_V1", json.dumps({
        "reason_supported": True, "coverage_a": coverage_a, "coverage_b": coverage_b,
        "exclusions_supported": True}))
    assert direct_vm.run_validator() is False


def test_validator_agrees_on_fully_supported_brief(board, direct_vm, direct_alice):
    contract, _, first, second = board
    direct_vm.sender = direct_alice
    compare(contract, direct_vm, first, second)
    direct_vm.mock_llm("^BOUNTYMERGE_AUDIT_V1", json.dumps({"reason_supported": True,
        "coverage_a": [True, True], "coverage_b": [True, True], "exclusions_supported": True}))
    assert direct_vm.run_validator() is True


def test_short_reason_is_audited_instead_of_bricking_comparison(board, direct_vm, direct_alice):
    contract, _, first, second = board
    direct_vm.sender = direct_alice
    direct_vm.clear_mocks()
    result = candidate()
    result["reason"] = "Both want CSV."
    direct_vm.mock_llm("^BOUNTYMERGE_COMPARE_V1", json.dumps(result))
    contract.compare_requests(first, second)
    direct_vm.mock_llm("^BOUNTYMERGE_AUDIT_V1", json.dumps({"reason_supported": False,
        "coverage_a": [True, True], "coverage_b": [True, True], "exclusions_supported": True}))
    assert direct_vm.run_validator() is False


def test_verbose_reason_is_bounded_and_audited(board, direct_vm, direct_alice):
    contract, project, first, second = board
    direct_vm.sender = direct_alice
    direct_vm.clear_mocks()
    result = candidate()
    result["reason"] = "Both requests have overlapping CSV needs. " * 30
    direct_vm.mock_llm("^BOUNTYMERGE_COMPARE_V1", json.dumps(result))
    contract.compare_requests(first, second)
    comparison = contract.list_comparisons(project, 0, 20)["items"][0]
    assert 100 < len(comparison["result"]["reason"]) <= 500
    assert comparison["result"]["reason"].endswith("...")
    direct_vm.mock_llm("^BOUNTYMERGE_AUDIT_V1", json.dumps({"reason_supported": False,
        "coverage_a": [True, True], "coverage_b": [True, True], "exclusions_supported": True}))
    assert direct_vm.run_validator() is False
