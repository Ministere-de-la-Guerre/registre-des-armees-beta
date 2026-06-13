# Registre des Armees

App-ready NTW3 unit data, icons, source-table exports, and reproducible build tools.

## Main Data

- `ntw3_army_builder_units.csv`: all allowed unit and army-corps combinations.
- `staff_general_corps_placement.csv`: staff-general placement evidence at the project root.
- `staff_general_corps_placement_with_stars.csv`: explicit star-ready staff-general copy.
- `assets/icons_by_army_corps/`: unit icons organized by corps key and division.
- `assets/staff_general_icons_by_corps/`: staff-general portraits organized at corps root.

All paths stored in the CSV files are relative to this project folder.

## General Command Stars

The stars shown beside staff-general and combat-general portraits are not baked into
the portrait files. Napoleon renders a separate star texture repeatedly. The number
of stars comes from:

`db/mp_general_command_ratings_tables/mp_general_command_ratings.command_stars`

The join is:

`mp_general_command_ratings.unit_key = ntw3_land_units.key`

This applies to both `gen_staff` units and combat-general `_com_` variants. A missing
rating means that no command-star overlay should be shown. Staff-general ratings use
1-9 stars; combat-general ratings currently use 1-7 stars.

The original game textures were copied read-only from `data.pack`:

- Silver: `ui/frontend ui/skins/army_card_star.tga`
- Gold: `ui/frontend ui/skins/spanish_skin/army_card_star.tga`

The gold texture matches the in-game example and is the recommended app asset.

### Ready-To-Use Assets

- `assets/ui/command_stars/star_gold.png`: one compact transparent gold star.
- `assets/ui/command_stars/star_silver.png`: one compact transparent silver star.
- `assets/ui/command_stars/vertical/command_stars_1.png` through
  `command_stars_9.png`: ready-made vertical overlays for the portrait's left edge.
- `assets/ui/command_stars/metadata.json`: dimensions, spacing, source, and path pattern.
- `source/original_game_command_star_assets/`: untouched extracted TGA copies.

The main troop CSV and staff-general CSV contain:

- `command_stars`: numeric rating; blank means no stars.
- `command_star_icon_path`: reusable single-star PNG.
- `command_star_strip_path`: ready-made PNG containing the correct star count.
- `command_star_layout`: currently `vertical_left`.

Example web layout:

```css
.portrait {
  position: relative;
}

.portrait-command-stars {
  position: absolute;
  left: 1px;
  top: 18px;
  image-rendering: auto;
}
```

Use the row's `command_star_strip_path` as the overlay image source. Keep the field
blank when `command_stars` is blank.

## Corps And Division Placement

Corps availability comes from exact `unit_key + faction_key` rows in
`units_to_exclusive_faction_permissions` where `allowed=true`.

Normal units use the `ACDV<division>B<brigade>` description tag and are copied to:

`assets/icons_by_army_corps/<faction_key>/Division_<number>/`

Staff generals do not contain an ACDV tag, so they belong at the army-corps root:

`assets/staff_general_icons_by_corps/<faction_key>/`

ToW icons are collected into their respective shared `TOW` folders.

## Army-Builder Rules

Reusable source-backed calculations are in `tools/army_builder_rules.py`. The main
CSV is the recruitable-card input: each row is an allowed `unit_key + faction_key`
pairing, and `base_mp_cost` is that card's `MPCost`. Commander variants therefore
use their own row cost without adding another base-unit cost.

Base army cost is:

```text
sum(selected card MPCost)
```

Only faction keys containing `_ac_` receive brigade or division discounts. Placement
is parsed strictly from `ACDV<division>B<brigade>`; the raw numeric division and
brigade IDs are used for pricing.

For every recruitable, tagged, non-general row in a group:

```text
roster cost contribution = Cap * MPCost
required count contribution = Cap
```

Generals are excluded from predefined roster cost and required count. Every selected
tagged card still adds one to its brigade and division completion count, including a
tagged combat general. A division is complete when its selected count reaches its
required count. A complete division receives only the division discount; otherwise,
each complete brigade receives its own discount. They do not stack.

```text
group discount = floor(group roster cost * (group required count - 1) / 100)
final AC cost = base army cost - total applied discount
```

German States detection splits the faction key on `_` and checks only whether the
fourth component contains lowercase `g`. Its applied discount is:

```text
floor(total normal discount * 1.5)
```

The code uses integer arithmetic for both floors.

### General And Card Limits

A General-class row is staff/nonfighting only when exact raw `Men / 2` is 16 or 61
(`men_raw` is 32 or 122); every other General-class row is combat. The display field
is not used because it can be floor-derived. Missing raw `Men` is reported rather
than guessed. Staff cap is 1. Combat cap is 1 for faction keys without `_ac_` and
without `_tow_`. For AC/ToW keys, trailing digits `N` are read from the fourth
underscore-separated component and combat cap is `9 - N`.

AC roster selection is a separate mode: staff maximum remains the staff cap and
combat maximum is `combat cap + 2`. This is not folded into normal cap checks.

Other implemented limits are 31 total cards, 2 foot artillery, 1 horse artillery,
and 10 heavy cavalry. A displayed division supports at most 7 brigade slots; seven
is a UI maximum, not a requirement that every slot be occupied.

### Known Unknowns

`UnitsOfTypeAndGens`, `UnitsCompatiblity`, XP-adjusted cost, and commander conflicts
are intentionally not implemented because their real source logic is not present in
the repository. See `reports/army_builder_rules_validation.txt` for current input
validation and unresolved mappings.

Run the rule tests with the bundled Python runtime or any Python 3.10+ interpreter:

```text
python -m unittest discover -s tools/tests -v
```

## Rebuild Tools

- `tools/build_ntw3_army_builder_database.py`
- `tools/organize_icons_by_army_corps.py`
- `tools/collect_staff_general_icons.py`
- `tools/build_command_star_assets.py`
- `tools/army_builder_rules.py`
- `tools/validate_army_builder_rules.py`

The original NTW3 installation is treated as read-only. Build outputs and extracted
copies are written only inside this repository.
