import os
import unittest
from unittest import mock

os.environ.setdefault("GOOGLE_API_KEY", "test-key")

from src.calculator import (
    compute_derived_cells,
    format_number,
    parse_numeric,
    validate_expression,
)
from src.schemas import (
    DataTableCellValue,
    DataTableRow,
    DerivedColumnSpec,
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


class TestValidateExpression(unittest.TestCase):
    def test_valid_arithmetic(self):
        self.assertIsNone(validate_expression("(a - b) / b * 100", ["a", "b"]))

    def test_valid_function_call(self):
        self.assertIsNone(
            validate_expression(
                "cohens_d(m1, s1, n1, m2, s2, n2)",
                ["m1", "s1", "n1", "m2", "s2", "n2"],
            )
        )

    def test_unknown_name_rejected(self):
        self.assertIn("unknown name", validate_expression("a + secret", ["a"]))

    def test_unknown_function_rejected(self):
        self.assertIn("unknown function", validate_expression("open('x')", []))

    def test_attribute_access_rejected(self):
        self.assertIn("disallowed", validate_expression("a.__class__", ["a"]))

    def test_string_literal_rejected(self):
        self.assertIn("non-numeric literal", validate_expression("'x' * 3", []))

    def test_comprehension_rejected(self):
        self.assertIn("disallowed", validate_expression("[i for i in (1,2)]", []))

    def test_syntax_error(self):
        self.assertIn("syntax", validate_expression("a +", ["a"]))


class TestParseNumeric(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(parse_numeric("56.9"), 56.9)

    def test_percent(self):
        self.assertEqual(parse_numeric("56.9%"), 56.9)

    def test_thousands_separator(self):
        self.assertEqual(parse_numeric("4,326"), 4326.0)

    def test_units(self):
        self.assertEqual(parse_numeric("5.2 ms"), 5.2)

    def test_negative(self):
        self.assertEqual(parse_numeric("-0.7"), -0.7)

    def test_na(self):
        self.assertIsNone(parse_numeric("N/A"))

    def test_empty(self):
        self.assertIsNone(parse_numeric(""))


@mock.patch.dict(os.environ, {"CALCULATOR_EXECUTOR": "local"})
class TestComputeDerivedCells(unittest.TestCase):
    def test_ratio_computed_with_derivation(self):
        rows = [make_row("p1", {"CoT (%)": "56.9", "Standard (%)": "17.9"})]
        specs = [
            DerivedColumnSpec(
                label="CoT/Standard ratio",
                expression="ratio(cot, std)",
                inputs={"cot": "CoT (%)", "std": "Standard (%)"},
            )
        ]
        compute_derived_cells(rows, specs)

        cell = rows[0].values["CoT/Standard ratio"]
        self.assertAlmostEqual(float(cell.value), 56.9 / 17.9, places=4)
        self.assertIsNotNone(cell.derivation)
        self.assertEqual(cell.derivation.expression, "ratio(cot, std)")
        self.assertEqual(len(cell.derivation.inputs), 2)
        self.assertEqual(cell.derivation.warnings, [])
        # inputs carry through the primitive citations
        by_alias = {i.alias: i for i in cell.derivation.inputs}
        self.assertEqual(by_alias["cot"].column, "CoT (%)")
        self.assertEqual(by_alias["cot"].value, "56.9")
        self.assertEqual(len(by_alias["cot"].citations), 1)

    def test_cohens_d(self):
        rows = [
            make_row(
                "p1",
                {
                    "mean_t": "4.8", "sd_t": "2.1", "n_t": "60",
                    "mean_c": "1.2", "sd_c": "2.3", "n_c": "58",
                },
            )
        ]
        specs = [
            DerivedColumnSpec(
                label="Cohen's d",
                expression="cohens_d(m1, s1, na, m2, s2, nb)",
                inputs={
                    "m1": "mean_t", "s1": "sd_t", "na": "n_t",
                    "m2": "mean_c", "s2": "sd_c", "nb": "n_c",
                },
            )
        ]
        compute_derived_cells(rows, specs)
        # hand-computed: pooled_sd = sqrt((59*2.1^2 + 57*2.3^2)/116) = 2.2007...
        value = float(rows[0].values["Cohen's d"].value)
        self.assertAlmostEqual(value, 1.6358, places=3)

    def test_missing_input_yields_na_with_warning(self):
        rows = [make_row("p1", {"a": "10", "b": "N/A"})]
        specs = [
            DerivedColumnSpec(
                label="diff", expression="a - b", inputs={"a": "a", "b": "b"}
            )
        ]
        compute_derived_cells(rows, specs)

        cell = rows[0].values["diff"]
        self.assertEqual(cell.value, "N/A")
        self.assertEqual(len(cell.derivation.warnings), 1)
        self.assertIn("b not reported", cell.derivation.warnings[0])

    def test_division_by_zero_yields_na_with_warning(self):
        rows = [make_row("p1", {"a": "10", "b": "0"})]
        specs = [
            DerivedColumnSpec(
                label="ratio", expression="a / b", inputs={"a": "a", "b": "b"}
            )
        ]
        compute_derived_cells(rows, specs)

        cell = rows[0].values["ratio"]
        self.assertEqual(cell.value, "N/A")
        self.assertTrue(
            any("computation failed" in w for w in cell.derivation.warnings)
        )

    def test_invalid_expression_yields_na_not_execution(self):
        rows = [make_row("p1", {"a": "10"})]
        specs = [
            DerivedColumnSpec(
                label="evil",
                expression="__import__('os').system('true')",
                inputs={"a": "a"},
            )
        ]
        compute_derived_cells(rows, specs)

        cell = rows[0].values["evil"]
        self.assertEqual(cell.value, "N/A")
        self.assertTrue(
            any("invalid expression" in w for w in cell.derivation.warnings)
        )

    def test_multiple_rows(self):
        rows = [
            make_row("p1", {"x": "10", "y": "5"}),
            make_row("p2", {"x": "9", "y": "3"}),
            make_row("p3", {"x": "N/A", "y": "3"}),
        ]
        specs = [
            DerivedColumnSpec(
                label="x/y", expression="x / y", inputs={"x": "x", "y": "y"}
            )
        ]
        compute_derived_cells(rows, specs)
        self.assertEqual(rows[0].values["x/y"].value, "2")
        self.assertEqual(rows[1].values["x/y"].value, "3")
        self.assertEqual(rows[2].values["x/y"].value, "N/A")

    def test_no_derived_columns_is_noop(self):
        rows = [make_row("p1", {"a": "1"})]
        compute_derived_cells(rows, [])
        self.assertEqual(set(rows[0].values.keys()), {"a"})

    def test_ambiguous_input_computes_with_warning(self):
        rows = [make_row("p1", {"a": "95% CI 15.8-16.0", "b": "5"})]
        specs = [
            DerivedColumnSpec(
                label="sum", expression="a + b", inputs={"a": "a", "b": "b"}
            )
        ]
        compute_derived_cells(rows, specs)

        cell = rows[0].values["sum"]
        self.assertEqual(cell.value, "100")  # first number (95) + 5
        self.assertTrue(
            any("multiple numbers" in w for w in cell.derivation.warnings)
        )


class TestExecutorSelection(unittest.TestCase):
    @mock.patch.dict(
        os.environ,
        {"CALCULATOR_EXECUTOR": "e2b", "E2B_DEV_API_KEY": "", "E2B_API_KEY": ""},
    )
    def test_explicit_e2b_without_key_raises(self):
        rows = [make_row("p1", {"a": "1", "b": "2"})]
        specs = [
            DerivedColumnSpec(
                label="sum", expression="a + b", inputs={"a": "a", "b": "b"}
            )
        ]
        with self.assertRaises(RuntimeError):
            compute_derived_cells(rows, specs)


class TestFormatNumber(unittest.TestCase):
    def test_trims(self):
        self.assertEqual(format_number(3.179888268156425), "3.17989")

    def test_integer(self):
        self.assertEqual(format_number(2.0), "2")

    def test_nan(self):
        self.assertEqual(format_number(float("nan")), "N/A")


if __name__ == "__main__":
    unittest.main()
