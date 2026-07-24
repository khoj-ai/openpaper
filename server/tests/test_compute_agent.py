import json
import unittest
from unittest import mock

from app.helpers.compute_agent import (
    OUTPUT_PATH,
    ComputeAgentError,
    run_computed_columns,
    serialize_table,
)
from app.schemas.responses import (
    CellEntry,
    ComputedColumnSpec,
    DataTableCellValue,
    DataTableRow,
    ResponseCitation,
)


def make_row(paper_id: str, values: dict[str, str]) -> DataTableRow:
    return DataTableRow(
        paper_id=paper_id,
        values={
            col: DataTableCellValue(
                value=val,
                citations=[ResponseCitation(text=f"quote for {col}", index=1)],
            )
            for col, val in values.items()
        },
    )


def make_list_row(
    paper_id: str, column: str, values: list[str], keys: list | None = None
) -> DataTableRow:
    keys = keys or [None] * len(values)
    entries = [
        CellEntry(
            value=v,
            key=k,
            citations=[ResponseCitation(text=f"quote {v}", index=1)],
        )
        for v, k in zip(values, keys)
    ]
    return DataTableRow(
        paper_id=paper_id,
        values={
            column: DataTableCellValue(
                value=", ".join(values), citations=[], entries=entries
            )
        },
    )


class FakeExecution:
    def __init__(self, stdout="", error=None):
        self.error = error
        self.logs = mock.Mock(stdout=[stdout] if stdout else [])


class FakeError:
    def __init__(self, name, value, traceback=""):
        self.name = name
        self.value = value
        self.traceback = traceback


class FakeSandbox:
    """Sandbox whose run_code plays back a queue of (execution, output_json)."""

    def __init__(self, runs):
        self.runs = list(runs)
        self.written: dict[str, str] = {}
        self.killed = False
        self.files = mock.Mock()
        self.files.write.side_effect = lambda path, data: self.written.__setitem__(
            path, data
        )
        self.files.read.side_effect = self._read

    def run_code(self, script, timeout=None):
        execution, output = self.runs.pop(0)
        self._current_output = output
        return execution

    def _read(self, path):
        if self._current_output is None:
            raise FileNotFoundError(path)
        return self._current_output

    def kill(self):
        self.killed = True


def patch_sandbox(fake):
    sandbox_cls = mock.Mock()
    sandbox_cls.create.return_value = fake
    return mock.patch.dict(
        "sys.modules",
        {"e2b_code_interpreter": mock.Mock(Sandbox=sandbox_cls)},
    )


ENV = {"E2B_API_KEY": "test-key"}


class TestSerializeTable(unittest.TestCase):
    def test_restricts_to_input_columns_and_drops_citations(self):
        row = make_row("p1", {"Accuracy": "56.9%", "Year": "2021"})
        snapshot = serialize_table([row], ["Accuracy"], {"p1": "Paper One"})
        self.assertEqual(
            snapshot,
            {
                "rows": [
                    {
                        "paper_id": "p1",
                        "paper_title": "Paper One",
                        "cells": {"Accuracy": {"value": "56.9%"}},
                    }
                ]
            },
        )

    def test_list_cells_carry_keyed_entries(self):
        row = make_list_row("p1", "Scores", ["80.65", "41.94"], ["GPT-4", "GPT-3.5"])
        snapshot = serialize_table([row], ["Scores"])
        self.assertEqual(
            snapshot["rows"][0]["cells"]["Scores"]["entries"],
            [
                {"key": "GPT-4", "value": "80.65"},
                {"key": "GPT-3.5", "value": "41.94"},
            ],
        )

    def test_missing_cell_omitted(self):
        row = make_row("p1", {"Accuracy": "56.9%"})
        snapshot = serialize_table([row], ["Accuracy", "F1"])
        self.assertEqual(list(snapshot["rows"][0]["cells"]), ["Accuracy"])


class TestRunComputedColumns(unittest.TestCase):
    def setUp(self):
        self.rows = [
            make_row("p1", {"Accuracy": "56.9%"}),
            make_row("p2", {"Accuracy": "41.0%"}),
        ]
        self.specs = [
            ComputedColumnSpec(
                label="Accuracy fraction",
                spec="accuracy as a fraction of 1",
                inputs=["Accuracy"],
            )
        ]

    def test_requires_api_key(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ComputeAgentError):
                run_computed_columns(self.rows, self.specs)

    def test_no_specs_is_noop(self):
        self.assertEqual(run_computed_columns(self.rows, []), {})

    def test_happy_path_attaches_cells_and_provenance(self):
        output = json.dumps(
            {
                "columns": {"Accuracy fraction": {"p1": 0.569, "p2": None}},
                "warnings": ["p2: accuracy not reported"],
            }
        )
        fake = FakeSandbox([(FakeExecution(stdout="computed 1 value\n"), output)])
        with mock.patch.dict("os.environ", ENV), patch_sandbox(fake), mock.patch(
            "app.helpers.compute_agent._generate_script",
            return_value="print('computed 1 value')",
        ):
            provenance = run_computed_columns(
                self.rows, self.specs, {"p1": "One", "p2": "Two"}
            )

        self.assertEqual(self.rows[0].values["Accuracy fraction"].value, "0.569")
        self.assertEqual(self.rows[1].values["Accuracy fraction"].value, "N/A")
        self.assertEqual(provenance["script"], "print('computed 1 value')")
        self.assertEqual(provenance["stdout"], "computed 1 value\n")
        self.assertEqual(provenance["warnings"], ["p2: accuracy not reported"])
        self.assertEqual(provenance["attempts"], 1)
        # The snapshot the script ran against was uploaded and persisted.
        self.assertIn("/home/user/table.json", fake.written)
        self.assertEqual(
            json.loads(fake.written["/home/user/table.json"]),
            provenance["inputs_snapshot"],
        )
        self.assertTrue(fake.killed)

    def test_runtime_error_triggers_repair(self):
        output = json.dumps({"columns": {"Accuracy fraction": {"p1": 0.569}}})
        fake = FakeSandbox(
            [
                (
                    FakeExecution(
                        error=FakeError("KeyError", "'Accuracy'", "traceback...")
                    ),
                    None,
                ),
                (FakeExecution(), output),
            ]
        )
        scripts = iter(["broken script", "fixed script"])
        with mock.patch.dict("os.environ", ENV), patch_sandbox(fake), mock.patch(
            "app.helpers.compute_agent._generate_script",
            side_effect=lambda **kwargs: next(scripts),
        ) as generate:
            provenance = run_computed_columns(self.rows, self.specs)

        self.assertEqual(provenance["attempts"], 2)
        self.assertEqual(provenance["script"], "fixed script")
        # The repair call saw the failed script and its error.
        repair_kwargs = generate.call_args_list[1].kwargs
        self.assertEqual(repair_kwargs["previous_script"], "broken script")
        self.assertIn("KeyError", repair_kwargs["previous_error"])
        self.assertEqual(self.rows[0].values["Accuracy fraction"].value, "0.569")

    def test_missing_requested_column_triggers_repair(self):
        incomplete = json.dumps({"columns": {"Wrong label": {"p1": 1}}})
        complete = json.dumps({"columns": {"Accuracy fraction": {"p1": 0.569}}})
        fake = FakeSandbox([(FakeExecution(), incomplete), (FakeExecution(), complete)])
        with mock.patch.dict("os.environ", ENV), patch_sandbox(fake), mock.patch(
            "app.helpers.compute_agent._generate_script",
            return_value="script",
        ):
            provenance = run_computed_columns(self.rows, self.specs)
        self.assertEqual(provenance["attempts"], 2)

    def test_all_attempts_fail_raises_and_leaves_rows_untouched(self):
        fake = FakeSandbox(
            [(FakeExecution(error=FakeError("Error", "boom")), None)] * 3
        )
        with mock.patch.dict("os.environ", ENV), patch_sandbox(fake), mock.patch(
            "app.helpers.compute_agent._generate_script",
            return_value="script",
        ):
            with self.assertRaises(ComputeAgentError):
                run_computed_columns(self.rows, self.specs)
        self.assertNotIn("Accuracy fraction", self.rows[0].values)
        self.assertTrue(fake.killed)

    def test_missing_output_file_is_a_contract_error(self):
        complete = json.dumps({"columns": {"Accuracy fraction": {"p1": 0.569}}})
        fake = FakeSandbox([(FakeExecution(), None), (FakeExecution(), complete)])
        with mock.patch.dict("os.environ", ENV), patch_sandbox(fake), mock.patch(
            "app.helpers.compute_agent._generate_script",
            return_value="script",
        ) as generate:
            provenance = run_computed_columns(self.rows, self.specs)
        self.assertEqual(provenance["attempts"], 2)
        self.assertIn(OUTPUT_PATH, generate.call_args_list[1].kwargs["previous_error"])

    def test_unknown_paper_ids_warned_and_ignored(self):
        output = json.dumps(
            {"columns": {"Accuracy fraction": {"p1": 0.569, "ghost": 1.0}}}
        )
        fake = FakeSandbox([(FakeExecution(), output)])
        with mock.patch.dict("os.environ", ENV), patch_sandbox(fake), mock.patch(
            "app.helpers.compute_agent._generate_script",
            return_value="script",
        ):
            provenance = run_computed_columns(self.rows, self.specs)
        self.assertTrue(any("ghost" in w for w in provenance["warnings"]))
        self.assertNotIn("ghost", [r.paper_id for r in self.rows])

    def test_string_values_pass_through(self):
        output = json.dumps(
            {"columns": {"Accuracy fraction": {"p1": "not computable", "p2": 3}}}
        )
        fake = FakeSandbox([(FakeExecution(), output)])
        with mock.patch.dict("os.environ", ENV), patch_sandbox(fake), mock.patch(
            "app.helpers.compute_agent._generate_script",
            return_value="script",
        ):
            run_computed_columns(self.rows, self.specs)
        self.assertEqual(
            self.rows[0].values["Accuracy fraction"].value, "not computable"
        )
        self.assertEqual(self.rows[1].values["Accuracy fraction"].value, "3")


if __name__ == "__main__":
    unittest.main()
