from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import factual_validation as validation


class FactualValidationTests(unittest.TestCase):
    def test_financial_abbreviation_cannot_change_magnitude(self):
        with self.assertRaisesRegex(ValueError, "unsupported-number"):
            validation.validate_numbers("Revenue was $10M.", "Revenue was $10B.")

    def test_spelled_and_abbreviated_units_are_equivalent(self):
        validation.validate_numbers("Revenue was $10B.", "Revenue was $10 billion.")
        validation.validate_numbers("$10B投資を発表。", "Announces a $10 billion investment.")
        validation.validate_numbers("Margin was 25％.", "Margin was 25 percent.")

    def test_abbreviated_units_remain_bound_to_their_number(self):
        with self.assertRaisesRegex(ValueError, "unsupported-number"):
            validation.validate_numbers("Revenue was $10B.", "Revenue was $10M and backlog was $9B.")


if __name__ == "__main__":
    unittest.main()
