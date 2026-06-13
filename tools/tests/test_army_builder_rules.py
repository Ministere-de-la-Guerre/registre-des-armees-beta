from __future__ import annotations

import unittest

from tools.army_builder_rules import (
    MAX_BRIGADE_SLOTS_PER_DIVISION,
    Placement,
    RuleDataError,
    UnitCard,
    ac_selection_general_maxima,
    calculate_army_cost,
    check_known_limits,
    general_caps,
)


def card(
    key: str,
    *,
    faction: str = "ntw3_ac_test_x5_001",
    unit_class: str = "infantry_line",
    men: int | None = 100,
    division: int | None = 1,
    brigade: int | None = 1,
    cost: int = 100,
    cap: int = 1,
) -> UnitCard:
    return UnitCard(
        unit_key=key,
        faction_key=faction,
        unit_class=unit_class,
        men_raw=men,
        placement=(
            Placement(division, brigade)
            if division is not None and brigade is not None
            else None
        ),
        mp_cost=cost,
        cap=cap,
        is_general=unit_class == "general",
    )


class PricingTests(unittest.TestCase):
    def test_normal_brigade_discount(self) -> None:
        faction = "ntw3_ac_test_x5_001"
        unit = card("line", faction=faction, cost=500, cap=2)
        sibling = card("sibling", faction=faction, brigade=2, cost=100, cap=1)
        result = calculate_army_cost([unit, unit], [unit, sibling], faction)

        self.assertEqual(result.base_cost, 1000)
        self.assertEqual(result.normal_discount, 10)
        self.assertEqual(result.final_cost, 990)
        self.assertEqual(result.completed_groups[0].group_type, "brigade")

    def test_full_division_replaces_brigade_discounts(self) -> None:
        faction = "ntw3_ac_test_x5_001"
        first = card("first", faction=faction, brigade=1, cost=100, cap=2)
        second = card("second", faction=faction, brigade=2, cost=100, cap=2)
        selected = [first, first, second, second]
        result = calculate_army_cost(selected, [first, second], faction)

        self.assertEqual(result.normal_discount, 12)
        self.assertEqual(len(result.completed_groups), 1)
        self.assertEqual(result.completed_groups[0].group_type, "division")

    def test_german_states_multiplies_total_normal_discount(self) -> None:
        faction = "ntw3_ac_test_g5_001"
        unit = card("line", faction=faction, cost=500, cap=2)
        sibling = card("sibling", faction=faction, brigade=2, cost=100, cap=1)
        result = calculate_army_cost([unit, unit], [unit, sibling], faction)

        self.assertEqual(result.normal_discount, 10)
        self.assertEqual(result.applied_discount, 15)
        self.assertEqual(result.final_cost, 985)
        self.assertTrue(result.german_states)

    def test_tagged_general_can_complete_brigade_but_is_not_in_roster(self) -> None:
        faction = "ntw3_ac_test_x5_001"
        unit = card("line", faction=faction, cost=500, cap=2)
        general = card(
            "general", faction=faction, unit_class="general", men=80, cost=845, cap=1
        )
        sibling = card("sibling", faction=faction, brigade=2, cost=100, cap=1)
        result = calculate_army_cost(
            [unit, general], [unit, general, sibling], faction
        )

        self.assertEqual(result.base_cost, 1345)
        self.assertEqual(result.completed_groups[0].roster_cost, 1000)
        self.assertEqual(result.completed_groups[0].required_count, 2)
        self.assertEqual(result.completed_groups[0].selected_count, 2)
        self.assertEqual(result.normal_discount, 10)

    def test_verified_5645_example(self) -> None:
        faction = "ntw3_ac_test_x5_001"
        roster = [
            card("roster_a", faction=faction, cost=1003, cap=2),
            card("roster_b", faction=faction, cost=807, cap=2),
            card("roster_c", faction=faction, cost=384, cap=4),
            card("other_brigade", faction=faction, brigade=2, cost=100, cap=1),
        ]
        selected = [
            card(f"selected_{index}", faction=faction, cost=cost)
            for index, cost in enumerate([1003, 1003, 807, 807, 384, 384, 772])
        ]
        selected.append(
            card("tagged_general", faction=faction, unit_class="general", men=80, cost=845)
        )
        result = calculate_army_cost(selected, roster, faction)

        self.assertEqual(result.base_cost, 6005)
        self.assertEqual(result.completed_groups[0].roster_cost, 5156)
        self.assertEqual(result.completed_groups[0].required_count, 8)
        self.assertEqual(result.completed_groups[0].selected_count, 8)
        self.assertEqual(result.normal_discount, 360)
        self.assertEqual(result.final_cost, 5645)
        self.assertEqual(result.completed_groups[0].group_type, "brigade")

    def test_non_ac_faction_receives_no_discount(self) -> None:
        unit = card("line", faction="france", cost=500, cap=2)
        result = calculate_army_cost([unit, unit], [unit], "france")
        self.assertEqual(result.final_cost, 1000)
        self.assertEqual(result.normal_discount, 0)


class LimitTests(unittest.TestCase):
    def test_general_caps_and_separate_ac_selection_maximum(self) -> None:
        self.assertEqual(general_caps("france").combat, 1)
        self.assertEqual(general_caps("ntw3_tow_test_x8_001").combat, 1)
        self.assertEqual(general_caps("ntw3_ac_test_x5_001").combat, 4)
        self.assertEqual(ac_selection_general_maxima("ntw3_ac_test_x5_001").combat, 6)

    def test_known_card_and_type_limits(self) -> None:
        faction = "france"
        selected = [
            card(f"foot_{index}", faction=faction, unit_class="artillery_foot")
            for index in range(3)
        ]
        selected += [
            card(f"horse_{index}", faction=faction, unit_class="artillery_horse")
            for index in range(2)
        ]
        result = check_known_limits(selected, faction)
        rules = {violation.rule for violation in result.violations}
        self.assertEqual(rules, {"artillery_foot", "artillery_horse"})
        self.assertEqual(MAX_BRIGADE_SLOTS_PER_DIVISION, 7)

    def test_staff_general_is_based_only_on_exact_raw_men(self) -> None:
        faction = "france"
        staff_16 = card("staff16", faction=faction, unit_class="general", men=32)
        staff_61 = card("staff61", faction=faction, unit_class="general", men=122)
        combat = card("combat", faction=faction, unit_class="general", men=33)
        result = check_known_limits([staff_16, staff_61, combat], faction)
        rules = {violation.rule for violation in result.violations}
        self.assertEqual(result.counts["staff_generals"], 2)
        self.assertEqual(result.counts["combat_generals"], 1)
        self.assertEqual(rules, {"staff_generals"})

    def test_missing_general_men_is_not_guessed(self) -> None:
        unknown = card("unknown", faction="france", unit_class="general", men=None)
        with self.assertRaises(RuleDataError):
            check_known_limits([unknown], "france")


if __name__ == "__main__":
    unittest.main()
