"""Transport compatibility for genlayer-test on Windows and the pinned runner.

This changes mock transport encoding and temporary-file cleanup only; contract
decisions, storage, and validator outcomes remain untouched.
"""
import json
import os
import sys
import tempfile


def install():
    from gltest.direct import loader, wasi_mock
    from gltest.direct.vm import VMContext
    if getattr(loader, "_bountymerge_compat", False):
        return
    original_llm = wasi_mock._handle_llm_request

    def llm_json_text(vm, data):
        response = original_llm(vm, data)
        if isinstance(response, dict) and "ok" in response and not isinstance(response["ok"], str):
            return {**response, "ok": json.dumps(response["ok"], ensure_ascii=False)}
        return response

    wasi_mock._handle_llm_request = llm_json_text
    if sys.platform == "win32":
        def inject(vm):
            from genlayer import calldata
            from genlayer.types import Address
            address = lambda value: Address(value) if isinstance(value, bytes) else value
            encoded = calldata.encode({"contract_address": address(vm._contract_address),
                "sender_address": address(vm.sender), "origin_address": address(vm.origin),
                "stack": [], "value": vm._value, "datetime": vm._datetime,
                "is_init": False, "chain_id": vm._chain_id, "entry_kind": 0,
                "entry_data": b"", "entry_stage_data": None})
            fd, path = tempfile.mkstemp()
            try:
                os.write(fd, encoded)
                os.lseek(fd, 0, os.SEEK_SET)
                vm._original_stdin_fd = os.dup(0)
                os.dup2(fd, 0)
                vm._bountymerge_stdin_path = path
            finally:
                os.close(fd)
        original_cleanup = VMContext._cleanup_after_deactivate

        def cleanup(vm):
            path = getattr(vm, "_bountymerge_stdin_path", None)
            try:
                original_cleanup(vm)
            finally:
                if path:
                    try:
                        os.unlink(path)
                    except FileNotFoundError:
                        pass
                    vm._bountymerge_stdin_path = None

        loader._inject_message_to_fd0 = inject
        VMContext._cleanup_after_deactivate = cleanup
    loader._bountymerge_compat = True
