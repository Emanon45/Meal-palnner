"""Weekly Canadian grocery flyer & meal plan pipeline.

Queries Flipp's structured backend API for Maxi (2349) and Super C (2585),
compares stores using a 65% lean protein / 35% carb+produce weighted basket,
optionally customizes seasoning/rotation notes via Google Gemini (google-genai)
with a strict zero-added-oil sanitizer and deterministic fallback, and writes
byte-identical UTF-8 JSON to both `public/data.json` and `./data.json`.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]
    ZoneInfoNotFoundError = Exception  # type: ignore[assignment,misc]

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover
    genai = None  # type: ignore[assignment]
    genai_types = None  # type: ignore[assignment]


SCHEMA_VERSION = "1.0.0"
DEFAULT_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "nutrition_baseline.json"
FLIPP_SEARCH_URL = "https://backflipp.wishabi.com/flipp/items/search"
FLIPP_ITEM_URL = "https://backflipp.wishabi.com/flipp/items/{item_id}"
DEFAULT_POSTAL_CODE = "H1W"
REQUEST_TIMEOUT_SECONDS = 12
ITEM_DETAIL_TIMEOUT_SECONDS = 5
UPCOMING_FLYER_MAX_HORIZON = dt.timedelta(days=7)
PRICE_HISTORY_WINDOW_WEEKS = 52
PRICE_HISTORY_MAX_AGE_DAYS = 364
MIN_HISTORY_OBS = 4

STORES: dict[str, dict[str, Any]] = {
    "Maxi": {"merchant_id": 2349, "aliases": {"maxi"}},
    "Super C": {"merchant_id": 2585, "aliases": {"super c"}},
}

PROTEIN_WEIGHTS: dict[str, float] = {
    "pork": 0.1625,
    "chicken": 0.1625,
    "canned_fish": 0.1625,
    "eggs": 0.1625,
}

CARB_PRODUCE_WEIGHTS: dict[str, float] = {
    "potatoes": 0.05,
    "rice": 0.05,
    "cabbage": 0.05,
    "cucumbers": 0.05,
    "tomatoes": 0.05,
    "carrots": 0.05,
    "white_beans": 0.05,
}

SUBCATEGORY_WEIGHTS: dict[str, float] = {
    **PROTEIN_WEIGHTS,
    **CARB_PRODUCE_WEIGHTS,
}

SAFE_NEGATION_RE = re.compile(
    r"\b(?:0\s*g|zero|no|without|sans)\s+(?:added\s+)?(?:cooking\s+)?(?:oil|huile)\b|\boil[- ]free\b",
    re.IGNORECASE,
)

ADDED_OIL_RE = re.compile(
    r"\b(oils?|oily|oiled|huiles?|butters?|buttered|buttery|beurres?|ghees?|tallows?|lards?|shortenings?|margarines?|sprays?|sprayed|pam)\b",
    re.IGNORECASE,
)


def contains_added_oil(text: str | None) -> bool:
    """Return True if text mentions added oils/fats (allowing boil/broil/foil/tenderloin and 0g oil/oil-free)."""
    if not isinstance(text, str):
        return False
    cleaned = SAFE_NEGATION_RE.sub(" ", text)
    return bool(ADDED_OIL_RE.search(cleaned))


# Alias matching Explorer 3 naming
contains_banned_oil = contains_added_oil


def _require_finite_number(val: Any, context: str, *, allow_zero: bool) -> float:
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        raise ValueError(f"{context} must be a finite number")
    num = float(val)
    if not math.isfinite(num):
        raise ValueError(f"{context} must be finite")
    if allow_zero:
        if num < 0:
            raise ValueError(f"{context} must be >= 0")
    else:
        if num <= 0:
            raise ValueError(f"{context} must be > 0")
    return num


def load_nutrition_baseline(schema_path: Path | str | None = None) -> dict[str, Any]:
    """Load and validate the shared nutrition/baseline schema JSON."""
    path = Path(schema_path) if schema_path is not None else DEFAULT_SCHEMA_PATH
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Nutrition baseline schema must be a JSON object: {path}")

    required_top = ("schemaVersion", "aisleOrder", "goalPresets", "categoryBaselines", "nutritionDb")
    for key in required_top:
        if key not in raw:
            raise ValueError(f"Nutrition baseline schema missing required key {key!r}: {path}")

    if not isinstance(raw["schemaVersion"], str) or not raw["schemaVersion"].strip():
        raise ValueError("schemaVersion must be a non-empty string")

    raw_aisles = raw["aisleOrder"]
    if not isinstance(raw_aisles, list) or not raw_aisles:
        raise ValueError("aisleOrder must be a non-empty list of strings")
    aisle_set: set[str] = set()
    for idx, aisle in enumerate(raw_aisles):
        if not isinstance(aisle, str) or not aisle.strip():
            raise ValueError(f"aisleOrder[{idx}] must be a non-empty string")
        if aisle in aisle_set:
            raise ValueError(f"aisleOrder contains duplicate entry {aisle!r}")
        aisle_set.add(aisle)

    goal_presets = raw["goalPresets"]
    if not isinstance(goal_presets, dict) or not goal_presets:
        raise ValueError("goalPresets must be a non-empty object")
    for preset_id, preset in goal_presets.items():
        if not isinstance(preset, dict):
            raise ValueError(f"goalPresets[{preset_id!r}] must be an object")
        for macro in ("calories", "protein", "fat", "carbs"):
            if macro not in preset:
                raise ValueError(f"goalPresets[{preset_id!r}] missing {macro!r}")
            _require_finite_number(
                preset[macro],
                f"goalPresets[{preset_id!r}].{macro}",
                allow_zero=True,
            )

    cat = raw["categoryBaselines"]
    if not isinstance(cat, dict):
        raise ValueError("categoryBaselines must be an object")
    required_subcats = set(SUBCATEGORY_WEIGHTS.keys())
    for subkey in ("baselinePrices", "historicalLows", "defaultUnitWeights"):
        submap = cat.get(subkey)
        if not isinstance(submap, dict) or not submap:
            raise ValueError(f"categoryBaselines.{subkey} must be a non-empty object")
        missing_subcats = sorted(required_subcats - set(submap.keys()))
        if missing_subcats:
            raise ValueError(
                f"categoryBaselines.{subkey} missing required subcategories: {missing_subcats}"
            )
        for subcat_key, subcat_val in submap.items():
            _require_finite_number(
                subcat_val,
                f"categoryBaselines.{subkey}[{subcat_key!r}]",
                allow_zero=False,
            )

    db = raw["nutritionDb"]
    if not isinstance(db, dict) or not db:
        raise ValueError("nutritionDb must be a non-empty object")
    for ing_id, entry in db.items():
        if not isinstance(entry, dict):
            raise ValueError(f"nutritionDb[{ing_id!r}] must be an object")
        for field in ("name", "aisle", "per100g", "cookedYield", "packageGrams", "unitLabel", "price"):
            if field not in entry:
                raise ValueError(f"nutritionDb[{ing_id!r}] missing field {field!r}")
        if not isinstance(entry["name"], str) or not entry["name"].strip():
            raise ValueError(f"nutritionDb[{ing_id!r}].name must be a non-empty string")
        normalized_id = re.sub(r"([a-z])([A-Z])", r"\1 \2", str(ing_id).replace("_", " "))
        if contains_added_oil(normalized_id) or contains_added_oil(entry["name"]):
            raise ValueError(f"nutritionDb[{ing_id!r}] violates zero-added-oil rule")
        if not isinstance(entry["aisle"], str) or entry["aisle"] not in aisle_set:
            raise ValueError(f"nutritionDb[{ing_id!r}].aisle {entry['aisle']!r} not in aisleOrder")
        if not isinstance(entry["unitLabel"], str) or not entry["unitLabel"].strip():
            raise ValueError(f"nutritionDb[{ing_id!r}].unitLabel must be a non-empty string")
        _require_finite_number(
            entry["cookedYield"],
            f"nutritionDb[{ing_id!r}].cookedYield",
            allow_zero=False,
        )
        _require_finite_number(
            entry["packageGrams"],
            f"nutritionDb[{ing_id!r}].packageGrams",
            allow_zero=False,
        )
        per = entry["per100g"]
        if not isinstance(per, dict):
            raise ValueError(f"nutritionDb[{ing_id!r}].per100g must be an object")
        for macro in ("calories", "protein", "fat", "carbs"):
            if macro not in per:
                raise ValueError(f"nutritionDb[{ing_id!r}].per100g missing {macro!r}")
            _require_finite_number(
                per[macro],
                f"nutritionDb[{ing_id!r}].per100g.{macro}",
                allow_zero=True,
            )
        price = entry["price"]
        if not isinstance(price, dict):
            raise ValueError(f"nutritionDb[{ing_id!r}].price must be an object")
        for pfield in ("cadPer100g", "cadPerPackage", "regularCadPer100g", "historicalLowCadPer100g"):
            if pfield not in price:
                raise ValueError(f"nutritionDb[{ing_id!r}].price missing {pfield!r}")
            _require_finite_number(
                price[pfield],
                f"nutritionDb[{ing_id!r}].price.{pfield}",
                allow_zero=True,
            )

    return raw


_BASELINE_SCHEMA: dict[str, Any] = load_nutrition_baseline()

AISLES: tuple[str, ...] = tuple(_BASELINE_SCHEMA["aisleOrder"])

# Montreal H1W regular baseline prices, historical lows, and unit weights loaded from shared schema
BASELINE_PRICES: dict[str, float] = {
    k: float(v) for k, v in _BASELINE_SCHEMA["categoryBaselines"]["baselinePrices"].items()
}

HISTORICAL_LOWS: dict[str, float] = {
    k: float(v) for k, v in _BASELINE_SCHEMA["categoryBaselines"]["historicalLows"].items()
}

DEFAULT_UNIT_WEIGHTS: dict[str, float] = {
    k: float(v) for k, v in _BASELINE_SCHEMA["categoryBaselines"]["defaultUnitWeights"].items()
}

CATEGORY_SPECS: dict[str, dict[str, Any]] = {
    "pork": {
        "queries": ["porc", "pork"],
        "positive": ["porc", "pork"],
        "negative": [
            "saucisse", "saucisses", "sausage", "sausages",
            "boulette", "boulettes", "meatball", "meatballs",
            "cotes de dos", "cotes de flanc", "back ribs", "side ribs", "ribs",
            "jarret", "jarrets", "shank", "shanks", "osso buco",
            "jambon", "ham", "bacon", "creton", "cretons",
            "pate", "pates", "tourtiere", "tourtieres",
            "batonnets", "fromage", "mozzarella", "cuites", "cuits", "cooked",
            "pane", "panes", "panee", "panees", "breaded",
            "egg roll", "egg rolls", "rouleau", "rouleaux",
            "veau", "veal", "boeuf", "beef",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "chicken": {
        "queries": ["poulet", "chicken"],
        "positive": ["poulet", "chicken"],
        "negative": [
            "aile", "ailes", "aille", "ailles", "wing", "wings",
            "pane", "panes", "panee", "panees", "breaded",
            "escalopette", "escalopettes",
            "saucisse", "saucisses", "wiener", "wieners",
            "tartinade", "tartinades", "pate", "pates",
            "bouchee", "bouchees", "bite", "bites",
            "bacon", "miel", "cornichon", "cornichons",
            "nugget", "nuggets", "pepite", "pepites",
            "brochette", "brochettes", "tourtiere", "tourtieres",
            "tournedos", "lanieres", "strips", "grillee", "grillees", "grilled",
            "egg roll", "egg rolls", "rouleau", "rouleaux",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "canned_fish": {
        "queries": ["thon", "tuna", "sardines"],
        "positive": ["thon", "tuna", "sardine", "sardines"],
        "negative": [
            "surimi", "crevette", "crevettes", "shrimp", "shrimps",
            "saumon fume", "smoked salmon",
            "darne", "darnes", "steak", "steaks", "gratin", "gratins",
            "peche du jour", "soupe", "soupes", "soup", "soups",
            "salade", "salades", "salad", "salads",
            "craquelin", "craquelins", "cracker", "crackers",
            "chat", "cat food", "frais", "fraiche", "fresh",
            "huile", "oil", "dans l'huile", "a l'huile", "in oil",
            "beurre", "butter",
        ],
    },
    "eggs": {
        "queries": ["oeufs", "œufs", "eggs"],
        "positive": ["oeuf", "oeufs", "egg", "eggs"],
        "negative": [
            "sandwich", "sandwichs", "sandwiches",
            "bouchee", "bouchees", "bite", "bites",
            "egg roll", "egg rolls", "rouleau", "rouleaux",
            "chocolat", "chocolate", "paques", "easter",
            "nouille", "nouilles", "noodle", "noodles",
            "pate", "pates", "pasta", "mayo", "mayonnaise",
            "blancs d'oeuf", "blancs d'oeufs", "blanc d'oeuf",
            "egg white", "egg whites",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "potatoes": {
        "queries": ["pommes de terre", "potatoes"],
        "positive": ["pomme de terre", "pommes de terre", "potato", "potatoes", "grelot"],
        "negative": [
            "pommes de terre frites", "pomme de terre frites", "frites surgelees",
            "french fried", "french fries", "superfries", "tasti taters",
            "mccain", "cavendish", "croustille", "croustilles", "chips",
            "galette", "galettes", "hash brown", "hashbrown", "hash browns",
            "rondelle", "rondelles", "onion ring", "onion rings",
            "pizza", "pochette", "pochettes", "salade de pommes de terre",
            "patate douce", "patates douces", "sweet potato", "sweet potatoes",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "rice": {
        "queries": ["riz", "rice"],
        "positive": ["riz", "rice"],
        "negative": [
            "craquelin", "craquelins", "cracker", "crackers",
            "pouding", "poudings", "pudding", "puddings",
            "galette", "galettes", "rice cake", "rice cakes",
            "boisson", "boissons", "drink", "drinks",
            "lait", "milk", "souffle", "puffed",
            "cereale", "cereales", "cereal", "cereals",
            "bistro express", "vite & bon", "pret a servir", "micro-ondes",
            "sauce", "sauces",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "cabbage": {
        "queries": ["chou", "cabbage"],
        "positive": ["chou", "cabbage"],
        "negative": [
            "chou-fleur", "chou fleur", "cauliflower",
            "choux de bruxelles", "chou de bruxelles", "brussels",
            "kale", "chou-rave", "kohlrabi", "salade de chou", "coleslaw",
            "rouleau", "rouleaux", "roll", "rolls", "farcis",
            "kimchi", "choucroute", "sauerkraut",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "cucumbers": {
        "queries": ["concombre", "cucumber"],
        "positive": ["concombre", "concombres", "cucumber", "cucumbers"],
        "negative": [
            "cornichon", "cornichons", "pickle", "pickles", "pickled",
            "relish", "tartinade", "tartinades", "salade", "salades",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "tomatoes": {
        "queries": ["tomates", "tomatoes"],
        "positive": ["tomate", "tomates", "tomato", "tomatoes"],
        "negative": [
            "sauce", "sauces", "soupe", "soupes", "soup", "soups",
            "jus", "juice", "ketchup", "salsa",
            "pate de tomate", "tomato paste",
            "sardine", "sardines", "maquereau", "mackerel",
            "feves", "beans", "pizza", "pates", "pasta",
            "chips", "croustille", "croustilles",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "carrots": {
        "queries": ["carottes", "carrots"],
        "positive": ["carotte", "carottes", "carrot", "carrots"],
        "negative": [
            "gateau", "gateaux", "cake", "cakes",
            "muffin", "muffins", "jus", "juice",
            "soupe", "soupes", "soup", "soups",
            "bebe", "baby food", "puree",
            "huile", "oil", "beurre", "butter",
        ],
    },
    "white_beans": {
        "queries": ["legumineuses", "légumineuses", "haricots", "feves", "beans"],
        "positive": [
            "legumineuse", "legumineuses", "haricot", "haricots",
            "feve", "feves", "bean", "beans", "cannellini", "pois",
        ],
        "negative": [
            "haricots francais", "haricot francais", "french beans",
            "haricots verts", "haricot vert", "green beans",
            "haricots jaunes", "yellow beans", "edamame", "soya", "soy",
            "cafe", "coffee", "cacao", "chocolat", "chocolate",
            "au lard", "pork and beans", "sauce tomate", "erable", "maple",
            "table!",
            "huile", "oil", "beurre", "butter",
        ],
    },
}

USER_PROFILE: dict[str, Any] = {
    "description": "High-Protein Batch Prep • Zero Added Oil",
    "neighborhood": "Canada",
    "postalCode": "H1W",
    "zeroAddedOil": True,
}

GOAL_PRESETS: dict[str, dict[str, Any]] = copy.deepcopy(_BASELINE_SCHEMA["goalPresets"])

PROTEIN_SWAPS: dict[str, list[dict[str, str]]] = {
    "lunch": [
        {
            "id": "ground_chicken",
            "label": "Extra-Lean Ground Chicken",
            "shortLabel": "Ground Chicken",
            "style": "Poulet Rouge / Boustan Bowl",
            "primaryIngredient": "ground_chicken",
        },
        {
            "id": "tuna_patties",
            "label": "Spiced Tuna-Potato Patties",
            "shortLabel": "Tuna Patties",
            "style": "Crispy Air-Fried",
            "primaryIngredient": "tuna_water",
        },
        {
            "id": "sardine_tuna",
            "label": "Omega-3 Sardine + Tuna",
            "shortLabel": "Sardine + Tuna",
            "style": "Mediterranean Mix",
            "primaryIngredient": "sardines_water",
        },
    ],
    "dinner": [
        {
            "id": "pork_loin_lean",
            "label": "Trimmed Lean Pork Loin",
            "shortLabel": "Pork Loin",
            "style": "Henakisoa sy Tsaramaso",
            "primaryIngredient": "pork_loin_lean",
        },
        {
            "id": "pork_shoulder",
            "label": "Trimmed Pork Shoulder",
            "shortLabel": "Pork Shoulder",
            "style": "Traditional Henakisoa",
            "primaryIngredient": "pork_shoulder",
        },
        {
            "id": "chicken_breast",
            "label": "Lean Chicken Breast",
            "shortLabel": "Chicken Breast",
            "style": "Malagasy Chili Twist",
            "primaryIngredient": "chicken_breast",
        },
    ],
}

# Raw/as-purchased (or drained-edible for canned goods) per-100g nutrition DB loaded from shared schema.
DEFAULT_NUTRITION_DB: dict[str, dict[str, Any]] = copy.deepcopy(_BASELINE_SCHEMA["nutritionDb"])

BASE_MEAL_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "breakfast",
        "slot": "Breakfast",
        "title": "Eggs & Crispy Grelot Potatoes",
        "cookingMethod": (
            "Non-stick dry skillet scramble with splash of water/broth (0g oil) "
            "+ air-fried crispy potatoes + berries"
        ),
        "seasoningTwist": "Oregano, cracked black pepper, lemon zest, and fresh green onions",
        "swappable": False,
        "baseIngredients": [
            "whole_egg",
            "egg_whites",
            "potatoes_raw",
            "green_onion",
            "pico",
            "berries",
        ],
    },
    {
        "id": "lunch",
        "slot": "Lunch",
        "title": "Seared Protein & Jasmine Rice Bowl",
        "cookingMethod": (
            "Dry-seared in natural juices or air-fried (0g oil) over steamed rice "
            "with crunchy slaw"
        ),
        "seasoningTwist": "Smoked paprika, sumac, garlic powder, cumin, and lemon juice",
        "swappable": True,
        "baseIngredients": [
            "ground_chicken",
            "rice_dry",
            "cabbage",
            "cucumber",
            "carrots",
            "pico",
            "edamame",
            "corn",
            "tzatziki_0",
        ],
    },
    {
        "id": "dinner",
        "slot": "Dinner",
        "title": "Braised Protein & White Beans",
        "cookingMethod": (
            "Trimmed meat braised slowly in diced tomatoes, ginger, garlic, onion, "
            "and broth (0g oil), topped with 0% skyr dollop"
        ),
        "seasoningTwist": "Fresh grated ginger, crushed garlic, thyme, and mild chili flakes",
        "swappable": True,
        "baseIngredients": [
            "pork_loin_lean",
            "white_beans_cnd",
            "diced_tomatoes",
            "rice_dry",
            "skyr_0",
            "aromatics_zero",
        ],
    },
    {
        "id": "snack",
        "slot": "Snack",
        "title": "0% Skyr & Whey Fruit Bowl",
        "cookingMethod": "Whipped cold 0% skyr with whey isolate and fresh/thawed fruit",
        "seasoningTwist": "Cinnamon and vanilla extract",
        "swappable": False,
        "baseIngredients": ["skyr_0", "whey_isolate", "berries", "banana"],
    },
]

BASE_PREP_TIMELINE: list[dict[str, Any]] = [
    {
        "id": "step_1",
        "order": 1,
        "title": "Start Rice Cooker & Braise Dinner Protein + Beans",
        "station": "Rice Cooker + Dutch Oven",
        "startMinute": 0,
        "durationMinutes": 40,
        "timerSeconds": 2400,
        "parallelNote": "Rinse jasmine rice and start cooker; sear trimmed pork or chicken in hot dry pot, deglaze with diced tomatoes, ginger, garlic, and white beans.",
        "zeroOilNote": "Sear meat in its own natural moisture and deglaze with tomato juices and broth (0g oil).",
    },
    {
        "id": "step_2",
        "order": 2,
        "title": "Air-Fry Crispy Grelot Potatoes",
        "station": "Air Fryer",
        "startMinute": 5,
        "durationMinutes": 22,
        "timerSeconds": 1320,
        "parallelNote": "While dinner simmers, halve grelot potatoes, season with smoked paprika, garlic powder, and salt, and air-fry at 200C shaking halfway.",
        "zeroOilNote": "Mist lightly with water or broth before seasoning so spices adhere with zero added cooking oil.",
    },
    {
        "id": "step_3",
        "order": 3,
        "title": "Dry-Sear Lunch Protein (Ground Chicken or Tuna Patties)",
        "station": "Non-Stick Skillet",
        "startMinute": 10,
        "durationMinutes": 12,
        "timerSeconds": 720,
        "parallelNote": "Brown Walmart extra-lean ground chicken with cumin and sumac (or air-fry spiced tuna-potato patties) while potatoes crisp.",
        "zeroOilNote": "Cook in natural meat juices with a 2 tbsp splash of water or low-sodium broth (0g oil).",
    },
    {
        "id": "step_4",
        "order": 4,
        "title": "Cold Prep: Shred Cabbage, Carrots & Dice Cucumber",
        "station": "Prep Board",
        "startMinute": 18,
        "durationMinutes": 15,
        "timerSeconds": 900,
        "parallelNote": "Shred green cabbage and carrots and dice English cucumber into crisp meal-prep containers.",
        "zeroOilNote": "Dress slaw with lemon or lime juice, salt, and scallion with zero added oil.",
    },
    {
        "id": "step_5",
        "order": 5,
        "title": "Cool, Weigh & Split Fridge (Days 1-4) vs. Freezer (Day 5+)",
        "station": "Portioning Counter",
        "startMinute": 35,
        "durationMinutes": 15,
        "timerSeconds": 900,
        "parallelNote": "Weigh cooked batches by macro targets; keep Days 1-4 in fridge containers and freeze Day 5+ meals flat with 24h thaw labels.",
        "zeroOilNote": "Store broth-rich braises cleanly with zero added fats for clean reheating.",
    },
]

FALLBACK_PROFILES: list[dict[str, Any]] = [
    {
        "weeklyTheme": "Market Value Week — Ginger-Garlic Braise & Sumac Bowl",
        "produceRotationNote": "Spotlight crunchy green cabbage slaw, diced English cucumber, and fresh lasary voatabia.",
        "fruitRotationNote": "Pair breakfast with thawed mixed berries and post-workout snack with ripe banana.",
        "twists": {
            "breakfast": "Oregano, cracked black pepper, lemon zest, and fresh green onions",
            "lunch": "Smoked paprika, sumac, garlic powder, cumin, and lemon juice",
            "dinner": "Fresh grated ginger, crushed garlic, thyme, and mild chili flakes",
            "snack": "Cinnamon and pure vanilla extract",
        },
        "prepTips": {
            "step_1": "Rinse jasmine rice and start cooker; sear trimmed pork in hot dry pot, deglaze with diced tomatoes, ginger, garlic, and white beans.",
            "step_2": "While dinner simmers, halve grelot potatoes, season with smoked paprika and garlic powder, and air-fry at 200C shaking halfway.",
            "step_3": "Brown lunch ground chicken with cumin and sumac (or air-fry spiced tuna-potato patties) while potatoes crisp.",
            "step_4": "Shred green cabbage and carrots; dice Roma tomatoes, onion, and lime for pico de gallo; grate/squeeze cucumber and mix with 0% Greek yogurt, garlic, and lemon for tzatziki.",
            "step_5": "Weigh cooked portions; place Days 1-4 in fridge and freeze Day 5+ containers with 24h thaw reminders.",
        },
    },
    {
        "weeklyTheme": "Boustan-Inspired Citrus & Herb Week — Malagasy Chili & Crispy Grelots",
        "produceRotationNote": "Feature ribboned carrots, crisp cucumber coins, and tangy lime-scented pico.",
        "fruitRotationNote": "Alternate frozen blueberries in breakfast bowls and sliced banana in skyr.",
        "twists": {
            "breakfast": "Fresh chives, parsley, crushed red pepper, and black pepper",
            "lunch": "Lebanese 7-spice, lemon zest, dried mint, and roasted garlic powder",
            "dinner": "Malagasy ginger-scallion base, crushed tomatoes, bay leaf, and white pepper",
            "snack": "Ground cardamom and unsweetened cocoa powder",
        },
        "prepTips": {
            "step_1": "Start rice cooker first; simmer pork with bay leaf, grated ginger, garlic, diced tomatoes, and white beans.",
            "step_2": "Air-fry seasoned grelot potatoes at 200C in a single layer until golden and crisp.",
            "step_3": "Dry-sear lunch protein with Lebanese 7-spice and a splash of lemon-infused broth.",
            "step_4": "Julienne carrots, shred cabbage finely, and toss fresh tomato-onion lasary with lime juice.",
            "step_5": "Cool hot meals briefly before sealing Days 1-4 fridge tubs and Day 5+ freezer packs.",
        },
    },
    {
        "weeklyTheme": "St-Laurent Pantry Saver Week — Smoky Paprika & Fresh Tomato Zest",
        "produceRotationNote": "Balance crisp cabbage crunch with grated carrot and cool cucumber.",
        "fruitRotationNote": "Keep frozen mixed berries ready for quick morning thawing and banana for energy.",
        "twists": {
            "breakfast": "Dill, sea salt, garlic granules, and charred green onion",
            "lunch": "Za'atar-inspired thyme, sesame-free sumac, coriander, and lime juice",
            "dinner": "Roasted garlic, ginger, smoked paprika, and tangy diced tomato reduction",
            "snack": "Nutmeg, cinnamon, and lemon zest",
        },
        "prepTips": {
            "step_1": "Load rice cooker; dry-brown pork cubes and braise slowly in tomatoes, ginger, garlic, and beans.",
            "step_2": "Season potatoes with smoked paprika and roast in the air fryer until fork-tender.",
            "step_3": "Cook ground chicken in a hot non-stick skillet with coriander and broth splash.",
            "step_4": "Prep raw crunch veggies, dice tomatoes/onion/lime for pico de gallo, and mix grated cucumber with 0% yogurt, garlic, and lemon for tzatziki.",
            "step_5": "Label Days 1-4 for fridge and Day 5+ for freezer; stage Day 5 pack for 24h thaw.",
        },
    },
    {
        "weeklyTheme": "Clean & Lean Plateau Breaker — Bright Herb Scramble & Braised Beans",
        "produceRotationNote": "Prioritize crisp raw cucumber, shredded cabbage, and bright tomato pico.",
        "fruitRotationNote": "Use antioxidant berries at breakfast and potassium-rich banana in snack bowls.",
        "twists": {
            "breakfast": "Tarragon, black pepper, scallion tops, and fresh diced tomato",
            "lunch": "Turmeric, ground coriander, garlic, and bright lemon-mint zest",
            "dinner": "Crushed ginger, garlic, allspice pinch, thyme, and simmered white beans",
            "snack": "Espresso powder pinch and cinnamon",
        },
        "prepTips": {
            "step_1": "Set rice cooking; build flavor base with ginger, garlic, and tomatoes before adding pork and beans.",
            "step_2": "Air-fry potatoes in two shakes with garlic-herb seasoning and a water mist.",
            "step_3": "Sear lunch chicken with turmeric and coriander using broth to deglaze.",
            "step_4": "Shred cabbage and carrots into airtight crunch boxes; dice cucumbers separately.",
            "step_5": "Divide portions accurately into Days 1-4 fridge and Day 5+ freezer containers.",
        },
    },
]

GEMINI_PLAN_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "required": [
        "weeklyTheme",
        "produceRotationNote",
        "fruitRotationNote",
        "mealCustomizations",
        "prepTips",
    ],
    "properties": {
        "weeklyTheme": {"type": "STRING"},
        "produceRotationNote": {"type": "STRING"},
        "fruitRotationNote": {"type": "STRING"},
        "mealCustomizations": {
            "type": "OBJECT",
            "required": ["breakfast", "lunch", "dinner", "snack"],
            "properties": {
                "breakfast": {
                    "type": "OBJECT",
                    "required": ["seasoningTwist"],
                    "properties": {"seasoningTwist": {"type": "STRING"}},
                },
                "lunch": {
                    "type": "OBJECT",
                    "required": ["seasoningTwist"],
                    "properties": {"seasoningTwist": {"type": "STRING"}},
                },
                "dinner": {
                    "type": "OBJECT",
                    "required": ["seasoningTwist"],
                    "properties": {"seasoningTwist": {"type": "STRING"}},
                },
                "snack": {
                    "type": "OBJECT",
                    "required": ["seasoningTwist"],
                    "properties": {"seasoningTwist": {"type": "STRING"}},
                },
            },
        },
        "prepTips": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "required": ["stepId", "parallelNote"],
                "properties": {
                    "stepId": {"type": "STRING"},
                    "parallelNote": {"type": "STRING"},
                },
            },
        },
    },
}

class _AmericaTorontoFallback(dt.tzinfo):
    """Pure-stdlib America/Toronto EST/EDT tzinfo fallback when tzdata is absent."""

    @staticmethod
    def _nth_sunday(year: int, month: int, n: int) -> dt.date:
        first = dt.date(year, month, 1)
        offset = (6 - first.weekday()) % 7
        return first + dt.timedelta(days=offset + (n - 1) * 7)

    def _is_dst(self, dtime: dt.datetime) -> bool:
        year = dtime.year
        dst_start = dt.datetime.combine(self._nth_sunday(year, 3, 2), dt.time(2, 0))
        dst_end = dt.datetime.combine(self._nth_sunday(year, 11, 1), dt.time(2, 0))
        naive = dtime.replace(tzinfo=None)
        return dst_start <= naive < dst_end

    def utcoffset(self, dtime: dt.datetime | None) -> dt.timedelta:
        if dtime is None:
            return dt.timedelta(hours=-5)
        return dt.timedelta(hours=-4 if self._is_dst(dtime) else -5)

    def dst(self, dtime: dt.datetime | None) -> dt.timedelta:
        if dtime is None:
            return dt.timedelta(0)
        return dt.timedelta(hours=1 if self._is_dst(dtime) else 0)

    def tzname(self, dtime: dt.datetime | None) -> str:
        if dtime is None:
            return "EST"
        return "EDT" if self._is_dst(dtime) else "EST"


def get_montreal_tz() -> dt.tzinfo:
    """Return ZoneInfo('America/Toronto') or pure-stdlib Eastern Time fallback."""
    if ZoneInfo is not None:
        try:
            return ZoneInfo("America/Toronto")
        except (ZoneInfoNotFoundError, Exception):
            pass
    return _AmericaTorontoFallback()


def normalize_postal_code(postal_code: str) -> str:
    """Normalize a Canadian FSA or 6-char postal code to Flipp 6-char query format."""
    cleaned = re.sub(r"[\s-]+", "", (postal_code or "").strip().upper())
    if re.fullmatch(r"[A-Z]\d[A-Z]", cleaned):
        return f"{cleaned}1A1"
    if re.fullmatch(r"[A-Z]\d[A-Z]\d[A-Z]\d", cleaned):
        return cleaned
    raise ValueError(f"Invalid Canadian postal code / FSA: {postal_code!r}")


def format_postal_display(postal_code: str) -> str:
    """Return the 3-character Canadian FSA display code (e.g. 'H1W')."""
    cleaned = re.sub(r"[\s-]+", "", (postal_code or "").strip().upper())
    if re.fullmatch(r"[A-Z]\d[A-Z](?:\d[A-Z]\d)?", cleaned):
        return cleaned[:3]
    raise ValueError(f"Invalid Canadian postal code / FSA: {postal_code!r}")


def norm_text(text: str | None) -> str:
    """Normalize whitespace, non-breaking spaces, and typographic apostrophes."""
    if not text:
        return ""
    normalized = (
        text.replace("\xa0", " ")
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u02bc", "'")
    )
    return re.sub(r"\s+", " ", normalized).strip().lower()


def fold_accents(text: str | None) -> str:
    """Fold French accents and ligatures (œ->oe, æ->ae) for resilient matching."""
    cleaned = norm_text(text).replace("œ", "oe").replace("æ", "ae")
    decomposed = unicodedata.normalize("NFKD", cleaned)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", stripped).strip()


def _keyword_matches(folded_text: str, keyword: str) -> bool:
    kw = fold_accents(keyword)
    if not kw:
        return False
    # Use word/token boundaries around alphanumeric edges so 'ham' won't match 'haricots'
    # and 'pois' won't match 'poisson', while preserving trailing punctuation like 'table!'.
    pattern = r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])"
    return bool(re.search(pattern, folded_text))


def is_excluded_item(name: str, subcategory: str, description: str = "") -> bool:
    """Return True if an item name/description matches negative exclusions or lacks positive keywords."""
    spec = CATEGORY_SPECS.get(subcategory)
    if spec is None:
        return True
    combined = fold_accents(f"{name} {description}".strip())
    if not combined:
        return True
    for neg in spec["negative"]:
        if _keyword_matches(combined, neg):
            return True
    return not any(_keyword_matches(combined, pos) for pos in spec["positive"])


def is_egg_whites_item(name: str, description: str = "") -> bool:
    """Detect liquid egg whites products (routed to egg_whites, not whole_egg)."""
    combined = fold_accents(f"{name} {description}".strip())
    return any(
        _keyword_matches(combined, kw)
        for kw in ("blancs d'oeuf", "blancs d'oeufs", "blanc d'oeuf", "egg white", "egg whites")
    )


def match_target_store(item: dict[str, Any]) -> str | None:
    """Return 'Maxi' or 'Super C' if item is a valid flyer deal; reject Walmart & non-flyer items."""
    if not isinstance(item, dict):
        return None
    if item.get("item_type") not in (None, "flyer"):
        return None
    mname = norm_text(item.get("merchant_name"))
    if "walmart" in mname:
        return None
    mid = item.get("merchant_id")
    if mid == 2349 or mname == "maxi":
        return "Maxi"
    if mid == 2585 or mname == "super c":
        return "Super C"
    return None


def parse_iso_dt(value: str | None) -> dt.datetime | None:
    """Parse an ISO-8601 datetime string into UTC-aware datetime."""
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def default_flyer_period(now: dt.datetime | None = None) -> dict[str, str]:
    """Compute current Montreal Thursday-Wednesday flyer dates as fallback."""
    tz = get_montreal_tz()
    local_now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(tz)
    local_date = local_now.date()
    days_since_thu = (local_date.weekday() - 3) % 7
    valid_from = local_date - dt.timedelta(days=days_since_thu)
    valid_to = valid_from + dt.timedelta(days=6)
    return {"validFrom": valid_from.isoformat(), "validTo": valid_to.isoformat()}


def select_active_flyer_items(
    items: list[dict[str, Any]],
    now: dt.datetime | None = None,
    *,
    allow_upcoming: bool = True,
    max_upcoming_horizon: dt.timedelta = UPCOMING_FLYER_MAX_HORIZON,
    upcoming_window_start: dt.datetime | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Filter items to the active (or near-term upcoming) flyer window & compute Montreal flyerPeriod."""
    now_utc = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    tz = get_montreal_tz()

    parsed_rows: list[tuple[dict[str, Any], dt.datetime, dt.datetime]] = []
    for item in items:
        vf = parse_iso_dt(item.get("valid_from"))
        vt = parse_iso_dt(item.get("valid_to"))
        if vf is None or vt is None or vf > vt:
            continue
        parsed_rows.append((item, vf, vt))

    if not parsed_rows:
        return [], default_flyer_period(now_utc)

    active = [row for row in parsed_rows if row[1] <= now_utc <= row[2]]
    if active:
        chosen = active
    else:
        if not allow_upcoming:
            return [], default_flyer_period(now_utc)
        horizon_end = now_utc + max_upcoming_horizon
        upcoming = [row for row in parsed_rows if now_utc < row[1] <= horizon_end]
        if not upcoming:
            return [], default_flyer_period(now_utc)
        window_start = (
            upcoming_window_start
            if upcoming_window_start is not None
            else min(row[1] for row in upcoming)
        )
        chosen = [
            row
            for row in upcoming
            if window_start <= row[1] <= window_start + dt.timedelta(hours=24)
        ]
        if not chosen:
            return [], default_flyer_period(now_utc)

    min_start = min(row[1] for row in chosen).astimezone(tz).date()
    max_end = max(row[2] for row in chosen).astimezone(tz).date()
    return [row[0] for row in chosen], {
        "validFrom": min_start.isoformat(),
        "validTo": max_end.isoformat(),
    }


def _norm_unit_str(value: str | None) -> str:
    if not value:
        return ""
    cleaned = value.replace("\xa0", " ").strip()
    return re.sub(r"(?<=\d),(?=\d)", ".", cleaned)


def _to_grams(value: float, unit: str) -> float:
    u = unit.lower()
    if u == "kg":
        return value * 1000.0
    if u == "g":
        return value
    if u in ("lb", "lbs"):
        return value * 453.59237
    if u == "oz":
        return value * 28.349523125
    if u == "l":
        return value * 1000.0
    if u == "ml":
        return value
    return value


def _extract_weight_grams(text: str) -> float | None:
    if not text:
        return None
    normed = _norm_unit_str(text)

    # 1. Multiplier: 2x170g, 4 x 125 g
    m_mult = re.search(
        r"\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz|ml|l)\b",
        normed,
        re.IGNORECASE,
    )
    if m_mult:
        count = int(m_mult.group(1))
        val = float(m_mult.group(2))
        if count > 0 and val > 0:
            return count * _to_grams(val, m_mult.group(3))

    # 2. Slash multi-format: 85/170 G, 540/796 ML
    m_slash = re.search(
        r"\b(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz|ml|l)\b",
        normed,
        re.IGNORECASE,
    )
    if m_slash:
        a = float(m_slash.group(1))
        b = float(m_slash.group(2))
        if max(a, b) > 0:
            return _to_grams(max(a, b), m_slash.group(3))

    # 3. Hyphen range: 1-2.25 KG, 341-398 ML
    m_range = re.search(
        r"\b(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz|ml|l)\b",
        normed,
        re.IGNORECASE,
    )
    if m_range:
        a = float(m_range.group(1))
        b = float(m_range.group(2))
        if (a + b) > 0:
            return _to_grams((a + b) / 2.0, m_range.group(3))

    # 4. Single weight: SAC DE 10 LB, 198 g, 2 kg
    m_single = re.search(
        r"\b(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz|ml|l)\b",
        normed,
        re.IGNORECASE,
    )
    if m_single:
        val = float(m_single.group(1))
        if val > 0:
            return _to_grams(val, m_single.group(2))

    return None


def _match_post_unit_rate(post: str, unit_price: float) -> tuple[float, float, str] | None:
    """Match explicit /100g, /lb, or /kg rate suffixes without misreading multi-unit weights."""
    if not post:
        return None
    if re.search(
        r"(?<!\d)/\s*100\s*g\b|\b(?:per|par)\s+100\s*g\b|^(?:\$|cad\s*)?(?:1\s*)?100\s*g\b",
        post,
        re.IGNORECASE,
    ):
        return round(unit_price, 4), 100.0, "/100g"
    if re.search(
        r"(?<!\d)/\s*lbs?\b|\b(?:per|par)\s+lbs?\b|^(?:\$|cad\s*)?(?:1\s*)?lbs?\b",
        post,
        re.IGNORECASE,
    ):
        return round(unit_price / 4.5359237, 4), 454.0, "/lb"
    if re.search(
        r"(?<!\d)/\s*kg\b|\b(?:per|par)\s+kg\b|^(?:\$|cad\s*)?(?:1\s*)?kg\b",
        post,
        re.IGNORECASE,
    ):
        return round(unit_price / 10.0, 4), 1000.0, "/kg"
    return None


def parse_unit_price_per_100g(
    item: dict[str, Any],
    subcategory: str,
    detail_fetcher: Callable[[Any], dict[str, Any] | None] | None = None,
    default_unit_weights: dict[str, float] | None = None,
) -> tuple[float | None, float | None, str]:
    """Parse (cad_per_100g, package_grams, unit_note) for a Flipp item.

    Returns (None, None, "") if price is missing/invalid.
    """
    raw_price = item.get("current_price")
    if raw_price is None or isinstance(raw_price, bool):
        return None, None, ""
    try:
        price_val = float(raw_price)
    except (TypeError, ValueError):
        return None, None, ""
    if not math.isfinite(price_val) or price_val <= 0:
        return None, None, ""

    # Handle multi-buy pre_price_text like "3/", "2/", "3 pour"
    unit_price = price_val
    pre = _norm_unit_str(item.get("pre_price_text"))
    m_multi = re.match(r"^\s*(\d+)\s*(?:/|(?:pour|for)\b)", pre, re.IGNORECASE)
    if m_multi:
        divisor = int(m_multi.group(1))
        if 2 <= divisor <= 20:
            unit_price = price_val / divisor

    post = _norm_unit_str(item.get("post_price_text"))
    name = _norm_unit_str(item.get("name"))
    story = _norm_unit_str(item.get("sale_story"))
    desc = _norm_unit_str(item.get("description"))

    # Case A: explicit post_price_text unit rate (prioritize /100g, then /lb before /kg)
    post_rate = _match_post_unit_rate(post, unit_price)
    if post_rate is not None:
        return post_rate

    # Case B: packaged weight in post_price_text, name, or existing description
    weight_grams = _extract_weight_grams(post)
    if weight_grams is None:
        weight_grams = _extract_weight_grams(name)
    if weight_grams is None and desc:
        weight_grams = _extract_weight_grams(desc)

    # Optional live detail enrichment if neither post rate nor name weight matched
    if weight_grams is None and not desc and detail_fetcher is not None:
        item_id = item.get("flyer_item_id") or item.get("id")
        if item_id is not None:
            detail = detail_fetcher(item_id)
            if isinstance(detail, dict):
                desc = _norm_unit_str(detail.get("description"))
                if not post and detail.get("price_text"):
                    post = _norm_unit_str(detail.get("price_text"))
                    post_rate = _match_post_unit_rate(post, unit_price)
                    if post_rate is not None:
                        return post_rate
                    weight_grams = _extract_weight_grams(post)
                if weight_grams is None:
                    weight_grams = _extract_weight_grams(desc)

    # Fallback rate hint in sale_story or description when no package weight found
    if weight_grams is None:
        rate_hint = f"{story} {desc}".strip()
        if re.search(r"(?:\$|/)\s*lbs?\b", rate_hint, re.IGNORECASE):
            return round(unit_price / 4.5359237, 4), 454.0, "/lb (story)"
        if re.search(r"(?:\$|/)\s*kg\b", rate_hint, re.IGNORECASE):
            return round(unit_price / 10.0, 4), 1000.0, "/kg (story)"

    # Special case: eggs count (6/12/18/24/30 or douz./doux., default 12 * 50g = 600g)
    if weight_grams is None and subcategory == "eggs":
        egg_text = fold_accents(f"{name} {desc}")
        egg_count = 12
        m_eggs = re.search(r"\b(6|12|18|24|30)\s*(?:un\.?|oeufs|eggs|pack|pk)?\b", egg_text)
        if m_eggs:
            egg_count = int(m_eggs.group(1))
        elif re.search(r"\bdouz\.?\b|\bdoux\.?\b", egg_text):
            egg_count = 12
        weight_grams = float(egg_count * 50)
        return round(unit_price / (weight_grams / 100.0), 4), weight_grams, f"{egg_count} eggs"

    # Special case: unit counts (e.g. "6 UN." mini cucumbers) or produce defaults
    if weight_grams is None:
        combined = fold_accents(f"{name} {desc}")
        m_units = re.search(r"\b(\d+)\s*un\.?\b", combined)
        if m_units:
            count = int(m_units.group(1))
            if 1 <= count <= 24:
                if subcategory == "cucumbers":
                    weight_grams = count * (100.0 if "mini" in combined else 350.0)
                else:
                    weight_grams = float(count * 150)
        if weight_grams is None:
            if subcategory == "tomatoes" and any(
                kw in combined for kw in ("en des", "diced", "aylmer", "primo", "unico")
            ):
                weight_grams = 540.0
            elif subcategory == "canned_fish" and "sardine" in combined:
                weight_grams = 106.0
            else:
                unit_weights = DEFAULT_UNIT_WEIGHTS if default_unit_weights is None else default_unit_weights
                weight_grams = unit_weights.get(subcategory, 500.0)

    cad_per_100g = round(unit_price / (weight_grams / 100.0), 4)
    return cad_per_100g, round(weight_grams, 2), f"{round(weight_grams)}g"


def _http_get_json(url: str, params: dict[str, str] | None = None, timeout: int = REQUEST_TIMEOUT_SECONDS) -> dict[str, Any]:
    headers = {
        "User-Agent": "MealPlanMontreal/1.0 (+https://github.com)",
        "Accept": "application/json",
    }
    if requests is not None:
        resp = requests.get(url, params=params, headers=headers, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    full_url = f"{url}?{urllib.parse.urlencode(params)}" if params else url
    req = urllib.request.Request(full_url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_flipp_items(
    postal_query: str,
    http_get: Callable[..., dict[str, Any]] | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], bool]:
    """Query Flipp across all 11 sub-category bilingual terms; return raw items per query group and online flag."""
    fetcher = http_get or _http_get_json
    detail_cache: dict[Any, dict[str, Any] | None] = {}

    def fetch_detail(item_id: Any) -> dict[str, Any] | None:
        if item_id in detail_cache:
            return detail_cache[item_id]
        try:
            payload = fetcher(
                FLIPP_ITEM_URL.format(item_id=item_id),
                params={"locale": "en-ca"},
                timeout=ITEM_DETAIL_TIMEOUT_SECONDS,
            )
            detail = payload.get("item") if isinstance(payload, dict) and "item" in payload else payload
            detail_cache[item_id] = detail if isinstance(detail, dict) else None
        except Exception:
            detail_cache[item_id] = None
        return detail_cache[item_id]

    query_to_cats: dict[str, list[str]] = {}
    for subcat, spec in CATEGORY_SPECS.items():
        for q in spec["queries"]:
            query_to_cats.setdefault(q, []).append(subcat)

    items_by_query: dict[str, list[dict[str, Any]]] = {}
    any_success = False
    for q in query_to_cats:
        try:
            payload = fetcher(
                FLIPP_SEARCH_URL,
                params={"locale": "en-ca", "postal_code": postal_query, "q": q},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            any_success = True
            items = payload.get("items", []) if isinstance(payload, dict) else []
            items_by_query[q] = items if isinstance(items, list) else []
        except Exception:
            items_by_query[q] = []

    # Attach detail_fetcher via special attribute only when live HTTP succeeded
    collected: dict[str, list[dict[str, Any]]] = {"Maxi": [], "Super C": []}
    seen_keys: set[tuple[str, Any]] = set()
    for q, items in items_by_query.items():
        for item in items:
            store = match_target_store(item)
            if store is None:
                continue
            dedup_id = item.get("flyer_item_id") or item.get("id") or (
                item.get("name"),
                item.get("current_price"),
                item.get("valid_from"),
            )
            key = (store, dedup_id)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            enriched = dict(item)
            if any_success and http_get is None:
                enriched["_detail_fetcher"] = fetch_detail
            collected[store].append(enriched)

    return collected, any_success


def score_stores(
    items_by_store: dict[str, list[dict[str, Any]]],
    now: dt.datetime | None = None,
    baseline_prices: dict[str, float] | None = None,
    default_unit_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Score Maxi vs Super C using 65% protein / 35% carb+produce weights and select one winner."""
    resolved_baselines = BASELINE_PRICES if baseline_prices is None else baseline_prices
    resolved_unit_weights = DEFAULT_UNIT_WEIGHTS if default_unit_weights is None else default_unit_weights
    now_utc = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    store_comparison: dict[str, dict[str, Any]] = {}
    best_deals_by_store: dict[str, dict[str, dict[str, Any]]] = {}
    best_ingredient_deals_by_store: dict[str, dict[str, dict[str, Any]]] = {}
    egg_whites_by_store: dict[str, dict[str, Any] | None] = {}
    flyer_periods_by_store: dict[str, dict[str, str]] = {}
    any_matched_deals = False

    filtered_by_store: dict[str, list[dict[str, Any]]] = {}
    for store in ("Maxi", "Super C"):
        # Ensure Walmart or other-store items are never scored even if passed directly to score_stores
        filtered_store_items = []
        for it in items_by_store.get(store, []):
            matched_store = match_target_store(it)
            if matched_store == store or (matched_store is None and it.get("merchant_name") is None and it.get("merchant_id") is None):
                filtered_store_items.append(it)
        filtered_by_store[store] = filtered_store_items

    all_filtered_items = filtered_by_store["Maxi"] + filtered_by_store["Super C"]
    global_active_items, _ = select_active_flyer_items(
        all_filtered_items,
        now=now_utc,
        allow_upcoming=False,
    )
    if global_active_items:
        allow_upcoming = False
        upcoming_window_start = None
    else:
        allow_upcoming = True
        global_upcoming_items, _ = select_active_flyer_items(
            all_filtered_items,
            now=now_utc,
            allow_upcoming=True,
        )
        upcoming_vfs = [
            vf
            for vf in (parse_iso_dt(it.get("valid_from")) for it in global_upcoming_items)
            if vf is not None
        ]
        upcoming_window_start = min(upcoming_vfs) if upcoming_vfs else None

    for store in ("Maxi", "Super C"):
        active_items, store_period = select_active_flyer_items(
            filtered_by_store[store],
            now=now_utc,
            allow_upcoming=allow_upcoming,
            upcoming_window_start=upcoming_window_start,
        )
        flyer_periods_by_store[store] = store_period

        best_by_cat: dict[str, dict[str, Any]] = {}
        best_by_ingredient: dict[str, dict[str, Any]] = {}
        matched_deals = 0
        best_egg_whites: dict[str, Any] | None = None

        # Route liquid egg whites separately if present
        for item in active_items:
            name = str(item.get("name") or "")
            desc = str(item.get("description") or "")
            if is_egg_whites_item(name, desc):
                detail_fetcher = item.get("_detail_fetcher")
                cad100, pkg_g, unit_note = parse_unit_price_per_100g(
                    item,
                    "eggs",
                    detail_fetcher=detail_fetcher,
                    default_unit_weights=resolved_unit_weights,
                )
                if cad100 is not None and (best_egg_whites is None or cad100 < best_egg_whites["cadPer100g"]):
                    best_egg_whites = {
                        "name": name.replace("\xa0", " ").strip(),
                        "cadPer100g": cad100,
                        "packageGrams": pkg_g or 500.0,
                        "unitNote": unit_note,
                    }

        for subcat in SUBCATEGORY_WEIGHTS:
            candidates: list[dict[str, Any]] = []
            for item in active_items:
                name = str(item.get("name") or "")
                desc = str(item.get("description") or "")
                if is_excluded_item(name, subcat, desc):
                    continue
                detail_fetcher = item.get("_detail_fetcher")
                cad100, pkg_g, unit_note = parse_unit_price_per_100g(
                    item,
                    subcat,
                    detail_fetcher=detail_fetcher,
                    default_unit_weights=resolved_unit_weights,
                )
                if cad100 is None:
                    continue
                candidates.append({
                    "name": name.replace("\xa0", " ").strip(),
                    "cadPer100g": cad100,
                    "packageGrams": pkg_g or resolved_unit_weights.get(subcat, 500.0),
                    "unitNote": unit_note,
                    "raw": item,
                })
            if candidates:
                best = min(candidates, key=lambda c: c["cadPer100g"])
                best_by_cat[subcat] = best
                matched_deals += 1
                any_matched_deals = True
                for cand in candidates:
                    ing_id = resolve_deal_ingredient_id(subcat, cand["name"])
                    if ing_id is not None and ing_id not in ("egg_whites", "ground_chicken"):
                        existing_ing = best_by_ingredient.get(ing_id)
                        if existing_ing is None or cand["cadPer100g"] < existing_ing["cadPer100g"]:
                            best_by_ingredient[ing_id] = {**cand, "subcategory": subcat}

        protein_sum = 0.0
        for subcat, weight in PROTEIN_WEIGHTS.items():
            price = best_by_cat[subcat]["cadPer100g"] if subcat in best_by_cat else resolved_baselines[subcat]
            protein_sum += weight * (price / resolved_baselines[subcat])
        protein_score = round(protein_sum / 0.65, 4)

        carb_sum = 0.0
        for subcat, weight in CARB_PRODUCE_WEIGHTS.items():
            price = best_by_cat[subcat]["cadPer100g"] if subcat in best_by_cat else resolved_baselines[subcat]
            carb_sum += weight * (price / resolved_baselines[subcat])
        carb_produce_score = round(carb_sum / 0.35, 4)

        weighted_score = round(0.65 * protein_score + 0.35 * carb_produce_score, 4)
        store_comparison[store] = {
            "weightedScore": weighted_score,
            "proteinScore": protein_score,
            "carbProduceScore": carb_produce_score,
            "matchedDeals": matched_deals,
        }
        best_deals_by_store[store] = best_by_cat
        best_ingredient_deals_by_store[store] = best_by_ingredient
        egg_whites_by_store[store] = best_egg_whites

    maxi = store_comparison["Maxi"]
    super_c = store_comparison["Super C"]
    if super_c["weightedScore"] < maxi["weightedScore"]:
        winning_store = "Super C"
    elif maxi["weightedScore"] < super_c["weightedScore"]:
        winning_store = "Maxi"
    elif super_c["matchedDeals"] > maxi["matchedDeals"]:
        winning_store = "Super C"
    else:
        winning_store = "Maxi"

    flyer_period = flyer_periods_by_store.get(winning_store) or default_flyer_period(now)
    # If winning store had 0 items but the other store had active items, inherit its active flyer window
    if store_comparison[winning_store]["matchedDeals"] == 0:
        other = "Super C" if winning_store == "Maxi" else "Maxi"
        if store_comparison[other]["matchedDeals"] > 0:
            flyer_period = flyer_periods_by_store[other]

    return {
        "winningStore": winning_store,
        "storeComparison": store_comparison,
        "flyerPeriod": flyer_period,
        "bestDeals": best_deals_by_store[winning_store],
        "eggWhitesDeal": egg_whites_by_store[winning_store],
        "bestDealsByStore": best_deals_by_store,
        "bestIngredientDeals": best_ingredient_deals_by_store[winning_store],
        "bestIngredientDealsByStore": best_ingredient_deals_by_store,
        "eggWhitesByStore": egg_whites_by_store,
        "hasLiveDeals": any_matched_deals,
    }


def compute_radar_tag(cad_per_100g: float, regular: float, historical_low: float, on_flyer: bool) -> tuple[int, str]:
    """Compute (savingsPct, radarTag) for a nutritionDb entry."""
    if not on_flyer or regular <= 0 or cad_per_100g >= regular:
        return 0, "REGULAR"
    savings_pct = max(0, round((regular - cad_per_100g) / regular * 100))
    if cad_per_100g <= historical_low * 1.02:
        return savings_pct, "HISTORIC LOW"
    if savings_pct >= 25:
        return savings_pct, "HOT DEAL"
    return savings_pct, "FLYER DEAL"


def _apply_deal_price(entry: dict[str, Any], deal: dict[str, Any]) -> None:
    cad_per_100g = round(float(deal["cadPer100g"]), 2)
    pkg_grams = float(entry["packageGrams"])
    regular = float(entry["price"]["regularCadPer100g"])
    hist_low = float(entry["price"]["historicalLowCadPer100g"])
    savings_pct, radar_tag = compute_radar_tag(cad_per_100g, regular, hist_low, on_flyer=True)
    entry["price"] = {
        "cadPer100g": cad_per_100g,
        "cadPerPackage": round(cad_per_100g * (pkg_grams / 100.0), 2),
        "regularCadPer100g": regular,
        "historicalLowCadPer100g": hist_low,
        "savingsPct": savings_pct,
        "radarTag": radar_tag,
        "flyerItemName": deal["name"],
        "onFlyer": True,
    }


def resolve_deal_ingredient_id(subcat: str, deal_name: str) -> str | None:
    """Map a Flipp subcategory and item name to its canonical nutritionDb ingredient ID."""
    folded = fold_accents(deal_name)

    if subcat == "pork":
        if any(k in folded for k in ("epaule", "picnic", "shoulder")):
            return "pork_shoulder"
        if any(k in folded for k in ("filet", "longe", "loin", "tenderloin")):
            return "pork_loin_lean"
        return "pork_loin_lean"

    if subcat == "chicken":
        if any(k in folded for k in ("poitrine", "breast", "filet")):
            return "chicken_breast"
        return None

    if subcat == "canned_fish":
        return "sardines_water" if "sardine" in folded else "tuna_water"

    if subcat == "eggs":
        return "whole_egg"

    if subcat == "egg_whites":
        return "egg_whites"

    if subcat == "tomatoes":
        if any(
            k in folded
            for k in (
                "en des", "diced", "coulis", "strained", "broye", "broyees",
                "crushed", "entieres", "passata", "boite", "conserve", "canned",
                "aylmer", "primo", "unico", "aurora",
            )
        ) or re.search(r"\b(?:796|680|540)\s*ml\b", folded):
            return "diced_tomatoes"
        return "pico"

    direct_map = {
        "potatoes": "potatoes_raw",
        "rice": "rice_dry",
        "cabbage": "cabbage",
        "cucumbers": "cucumber",
        "carrots": "carrots",
        "white_beans": "white_beans_cnd",
    }
    return direct_map.get(subcat)


_INGREDIENT_TO_SUBCATEGORY: dict[str, str] = {
    "pork_shoulder": "pork",
    "pork_loin_lean": "pork",
    "chicken_breast": "chicken",
    "sardines_water": "canned_fish",
    "tuna_water": "canned_fish",
    "whole_egg": "eggs",
    "egg_whites": "eggs",
    "diced_tomatoes": "tomatoes",
    "pico": "tomatoes",
    "potatoes_raw": "potatoes",
    "rice_dry": "rice",
    "cabbage": "cabbage",
    "cucumber": "cucumbers",
    "carrots": "carrots",
    "white_beans_cnd": "white_beans",
}


def build_nutrition_db(
    best_deals: dict[str, dict[str, Any]],
    egg_whites_deal: dict[str, Any] | None = None,
    ground_chicken_override: dict[str, Any] | None = None,
    base_db: dict[str, dict[str, Any]] | None = None,
    best_ingredient_deals: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Build all 25 nutritionDb entries, applying winning-store flyer deals while isolating ground_chicken."""
    db = copy.deepcopy(DEFAULT_NUTRITION_DB if base_db is None else base_db)

    if best_ingredient_deals is not None:
        for ing_id, deal in best_ingredient_deals.items():
            if ing_id in db and ing_id not in ("ground_chicken", "egg_whites"):
                _apply_deal_price(db[ing_id], deal)
    else:
        for subcat, deal in best_deals.items():
            ing_id = resolve_deal_ingredient_id(subcat, deal["name"])
            if ing_id is not None and ing_id in db:
                _apply_deal_price(db[ing_id], deal)

    if egg_whites_deal is not None and "egg_whites" in db:
        _apply_deal_price(db["egg_whites"], egg_whites_deal)

    # ground_chicken stays strictly isolated at Walmart Great Value baseline unless explicitly overridden
    if ground_chicken_override:
        _apply_deal_price(db["ground_chicken"], ground_chicken_override)

    return db


def validate_zero_added_oil(obj: Any, path: str = "root") -> list[tuple[str, str]]:
    """Recursively validate an object for zero-added-oil violations."""
    violations: list[tuple[str, str]] = []
    if isinstance(obj, str):
        if contains_added_oil(obj):
            violations.append((path, obj))
    elif isinstance(obj, list):
        for idx, val in enumerate(obj):
            violations.extend(validate_zero_added_oil(val, f"{path}[{idx}]"))
    elif isinstance(obj, dict):
        for k, val in obj.items():
            violations.extend(validate_zero_added_oil(val, f"{path}.{k}"))
    return violations


def sanitize_zero_oil(plan_data: dict[str, Any]) -> dict[str, Any]:
    """Ensure plan_data has zero banned oil words; raise ValueError if any remain."""
    violations = validate_zero_added_oil(plan_data)
    if violations:
        raise ValueError(f"Zero-added-oil violation detected at {violations[0][0]}: {violations[0][1]!r}")
    return plan_data


def build_fallback_plan(
    winning_store: str,
    deals: dict[str, Any] | None = None,
    flyer_period: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build deterministic zero-added-oil mealTemplates + prepTimeline rotated by flyer week."""
    period_key = (flyer_period or {}).get("validFrom", "2026-11-12")
    digest = hashlib.sha256(f"{period_key}:{winning_store}".encode("utf-8")).digest()
    profile = FALLBACK_PROFILES[digest[0] % len(FALLBACK_PROFILES)]

    meals = copy.deepcopy(BASE_MEAL_TEMPLATES)
    for meal in meals:
        meal_id = meal["id"]
        if meal_id in profile["twists"]:
            meal["seasoningTwist"] = profile["twists"][meal_id]

    timeline = copy.deepcopy(BASE_PREP_TIMELINE)
    for step in timeline:
        step_id = step["id"]
        if step_id in profile["prepTips"]:
            step["parallelNote"] = profile["prepTips"][step_id]

    deal_note = ""
    if deals:
        deal_names = [
            d["name"]
            for d in deals.values()
            if isinstance(d, dict) and d.get("name") and not contains_added_oil(d["name"])
        ][:3]
        if deal_names:
            deal_note = f" ({winning_store} flyer highlights: {', '.join(deal_names)})"

    return {
        "mealTemplates": {
            "weeklyTheme": f"{profile['weeklyTheme']}{deal_note}",
            "produceRotationNote": profile["produceRotationNote"],
            "fruitRotationNote": profile["fruitRotationNote"],
            "meals": meals,
        },
        "prepTimeline": timeline,
    }


def apply_gemini_customization(
    base_plan: dict[str, Any],
    gemini_payload: dict[str, Any],
) -> dict[str, Any]:
    """Merge safe Gemini text customizations onto base_plan without touching locked macros/ingredients/timers."""
    if not isinstance(gemini_payload, dict):
        raise ValueError("Gemini payload must be a JSON object")

    violations = validate_zero_added_oil(gemini_payload, path="gemini")
    if violations:
        raise ValueError(f"Gemini output violated zero-added-oil rule: {violations[0]}")

    merged = copy.deepcopy(base_plan)
    mt = merged["mealTemplates"]

    for field in ("weeklyTheme", "produceRotationNote", "fruitRotationNote"):
        val = gemini_payload.get(field)
        if isinstance(val, str) and val.strip():
            mt[field] = val.strip()

    customizations = gemini_payload.get("mealCustomizations")
    if isinstance(customizations, dict):
        for meal in mt["meals"]:
            c = customizations.get(meal["id"])
            if isinstance(c, dict) and isinstance(c.get("seasoningTwist"), str) and c["seasoningTwist"].strip():
                meal["seasoningTwist"] = c["seasoningTwist"].strip()
    elif isinstance(gemini_payload.get("meals"), list):
        by_id = {
            m.get("id"): m for m in gemini_payload["meals"]
            if isinstance(m, dict) and m.get("id")
        }
        for meal in mt["meals"]:
            c = by_id.get(meal["id"])
            if c and isinstance(c.get("seasoningTwist"), str) and c["seasoningTwist"].strip():
                meal["seasoningTwist"] = c["seasoningTwist"].strip()

    tips = gemini_payload.get("prepTips")
    if isinstance(tips, list):
        tip_map = {
            t.get("stepId"): t.get("parallelNote")
            for t in tips
            if isinstance(t, dict) and t.get("stepId") and isinstance(t.get("parallelNote"), str)
        }
        for step in merged["prepTimeline"]:
            note = tip_map.get(step["id"])
            if note and note.strip():
                step["parallelNote"] = note.strip()
    elif isinstance(gemini_payload.get("prepTimeline"), list):
        tip_map = {
            t.get("id"): t.get("parallelNote")
            for t in gemini_payload["prepTimeline"]
            if isinstance(t, dict) and t.get("id") and isinstance(t.get("parallelNote"), str)
        }
        for step in merged["prepTimeline"]:
            note = tip_map.get(step["id"])
            if note and note.strip():
                step["parallelNote"] = note.strip()

    sanitize_zero_oil(merged)
    return merged


def generate_meal_plan(
    winning_store: str,
    deals: dict[str, Any],
    flyer_period: dict[str, str] | None = None,
    api_key: str | None = None,
) -> tuple[dict[str, Any], str]:
    """Generate mealTemplates + prepTimeline using Gemini when available, else deterministic fallback."""
    base_plan = build_fallback_plan(winning_store, deals=deals, flyer_period=flyer_period)
    resolved_key = api_key if api_key is not None else os.environ.get("GEMINI_API_KEY", "")
    if not resolved_key or not resolved_key.strip() or genai is None or genai_types is None:
        return base_plan, "fallback"

    deal_summary = {
        cat: {"name": d["name"], "cadPer100g": d["cadPer100g"]}
        for cat, d in (deals or {}).items()
        if isinstance(d, dict) and "name" in d
    }
    prompt = (
        "You are a culinary assistant creating fresh weekly seasoning twists and prep tips "
        "for a Montreal meal-prep plan.\n"
        f"Winning grocery store this week: {winning_store}.\n"
        f"Flyer highlights: {json.dumps(deal_summary, ensure_ascii=False)}.\n"
        "STRICT RULES:\n"
        "1. ZERO ADDED COOKING OIL: NEVER mention oil, olive oil, vegetable oil, huile, butter, "
        "beurre, margarine, lard, shortening, cooking spray, or Pam. Use broth, water, tomato "
        "juices, lemon/lime juice, or dry heat.\n"
        "2. Keep base meals aligned to: breakfast (Greek egg scramble + grelot potatoes + berries), "
        "lunch (Poulet Rouge/Boustan high-protein bowl), dinner (Malagasy Henakisoa sy Tsaramaso "
        "chili-style pork + white beans), snack (0% Skyr + whey + fruit).\n"
        "3. Return JSON matching the schema with stepIds step_1 through step_5."
    )

    try:
        client = genai.Client(api_key=resolved_key.strip())
        config = genai_types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=GEMINI_PLAN_SCHEMA,
            temperature=0.4,
        )
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=config,
        )
        raw_text = getattr(response, "text", None)
        if isinstance(raw_text, str) and raw_text.strip():
            payload = json.loads(raw_text)
        elif isinstance(getattr(response, "parsed", None), dict):
            payload = response.parsed
        else:
            raise ValueError("Empty Gemini response")

        customized = apply_gemini_customization(base_plan, payload)
        return customized, "gemini"
    except Exception:
        return base_plan, "fallback"


def _iso_utc(now_utc: dt.datetime) -> str:
    return now_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _empty_price_history(now_utc: dt.datetime) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "windowWeeks": PRICE_HISTORY_WINDOW_WEEKS,
        "updatedAt": _iso_utc(now_utc),
        "byPostalCode": {},
    }


def _quantile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    pos = q * (len(sorted_vals) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(sorted_vals[lo])
    return float(sorted_vals[lo]) + (float(sorted_vals[hi]) - float(sorted_vals[lo])) * (pos - lo)


def load_and_prune_price_history(history_path: Path, now_utc: dt.datetime) -> dict[str, Any]:
    """Load price_history.json safely, recover from corruption, and prune entries older than 364 days."""
    if not history_path.exists():
        return _empty_price_history(now_utc)

    try:
        raw_text = history_path.read_text(encoding="utf-8")
        raw = json.loads(raw_text)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return _empty_price_history(now_utc)

    if not isinstance(raw, dict):
        return _empty_price_history(now_utc)

    raw_by_postal = raw.get("byPostalCode")
    if not isinstance(raw_by_postal, dict):
        raw_by_postal = {}

    today = now_utc.date()
    by_postal: dict[str, dict[str, list[dict[str, Any]]]] = {}

    for raw_fsa, ing_map in raw_by_postal.items():
        if not isinstance(raw_fsa, str) or not isinstance(ing_map, dict):
            continue
        try:
            fsa = format_postal_display(raw_fsa)
        except ValueError:
            continue

        postal_bucket = by_postal.setdefault(fsa, {})
        for ing_id, entries in ing_map.items():
            if not isinstance(ing_id, str) or not ing_id.strip() or not isinstance(entries, list):
                continue

            dedup: dict[tuple[str, str], dict[str, Any]] = {
                (e["observedAt"], e["store"]): e for e in postal_bucket.get(ing_id, [])
            }
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                obs_at = entry.get("observedAt")
                if not isinstance(obs_at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", obs_at):
                    continue
                try:
                    obs_date = dt.date.fromisoformat(obs_at)
                except ValueError:
                    continue
                age_days = (today - obs_date).days
                if age_days < 0 or age_days > PRICE_HISTORY_MAX_AGE_DAYS:
                    continue

                store = entry.get("store")
                if not isinstance(store, str) or not store.strip():
                    continue
                store_clean = store.strip()

                raw_price = entry.get("cadPer100g")
                if (
                    not isinstance(raw_price, (int, float))
                    or isinstance(raw_price, bool)
                    or not math.isfinite(float(raw_price))
                    or float(raw_price) <= 0.0
                ):
                    continue
                rounded_price = round(float(raw_price), 4)
                if rounded_price <= 0.0:
                    continue

                item_name = entry.get("itemName")
                subcat = entry.get("subcategory")
                if not isinstance(item_name, str) or not isinstance(subcat, str):
                    continue

                dedup[(obs_at, store_clean)] = {
                    "observedAt": obs_at,
                    "store": store_clean,
                    "cadPer100g": rounded_price,
                    "itemName": item_name,
                    "subcategory": subcat,
                }

            if dedup:
                postal_bucket[ing_id] = sorted(
                    dedup.values(),
                    key=lambda e: (e["observedAt"], e["store"]),
                )

        if not postal_bucket:
            by_postal.pop(fsa, None)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "windowWeeks": PRICE_HISTORY_WINDOW_WEEKS,
        "updatedAt": _iso_utc(now_utc),
        "byPostalCode": by_postal,
    }


def upsert_price_observations(
    history: dict[str, Any],
    postal_fsa: str,
    now_utc: dt.datetime,
    best_deals_by_store: dict[str, dict[str, dict[str, Any]]],
    egg_whites_by_store: dict[str, dict[str, Any] | None],
    best_ingredient_deals_by_store: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> None:
    """Idempotently upsert today's Flipp unit-price observations keyed by (observedAt, store, ingredientId)."""
    obs_date_str = now_utc.date().isoformat()
    by_postal = history.setdefault("byPostalCode", {})
    postal_bucket = by_postal.setdefault(postal_fsa, {})

    def _upsert(ing_id: str, store: str, deal: dict[str, Any], subcat: str) -> None:
        entries = postal_bucket.setdefault(ing_id, [])
        record = {
            "observedAt": obs_date_str,
            "store": store,
            "cadPer100g": round(float(deal["cadPer100g"]), 4),
            "itemName": str(deal["name"]),
            "subcategory": subcat,
        }
        replaced = False
        for idx, existing in enumerate(entries):
            if existing.get("observedAt") == obs_date_str and existing.get("store") == store:
                entries[idx] = record
                replaced = True
                break
        if not replaced:
            entries.append(record)
        entries.sort(key=lambda e: (e["observedAt"], e["store"]))

    for store in ("Maxi", "Super C"):
        if best_ingredient_deals_by_store is not None:
            for ing_id, deal in best_ingredient_deals_by_store.get(store, {}).items():
                if ing_id in ("ground_chicken", "egg_whites"):
                    continue
                subcat = str(deal.get("subcategory") or _INGREDIENT_TO_SUBCATEGORY.get(ing_id, ""))
                _upsert(ing_id, store, deal, subcat)
        else:
            for subcat, deal in best_deals_by_store.get(store, {}).items():
                ing_id = resolve_deal_ingredient_id(subcat, deal["name"])
                if ing_id is not None:
                    _upsert(ing_id, store, deal, subcat)
        ew_deal = egg_whites_by_store.get(store)
        if ew_deal is not None:
            _upsert("egg_whites", store, ew_deal, "eggs")

    if not postal_bucket:
        by_postal.pop(postal_fsa, None)


def calibrate_base_db_from_history(
    base_db: dict[str, dict[str, Any]],
    history: dict[str, Any],
    postal_fsa: str,
) -> dict[str, dict[str, Any]]:
    """Derive regularCadPer100g and historicalLowCadPer100g from 52-week postal history when >= MIN_HISTORY_OBS."""
    calibrated_db = copy.deepcopy(base_db)
    postal_obs = history.get("byPostalCode", {}).get(postal_fsa, {})
    if not isinstance(postal_obs, dict):
        return calibrated_db

    for ing_id, entry in calibrated_db.items():
        if ing_id in ("ground_chicken", "aromatics_zero"):
            continue
        obs_list = postal_obs.get(ing_id, [])
        if not isinstance(obs_list, list) or len(obs_list) < MIN_HISTORY_OBS:
            continue

        prices = sorted(float(o["cadPer100g"]) for o in obs_list)
        schema_reg = float(entry["price"]["regularCadPer100g"])
        cal_low = round(prices[0], 2)
        cal_reg = round(max(schema_reg, _quantile(prices, 0.75)), 2)

        entry["price"]["historicalLowCadPer100g"] = cal_low
        entry["price"]["regularCadPer100g"] = cal_reg
        if not entry["price"].get("onFlyer", False):
            entry["price"]["cadPer100g"] = cal_reg
            entry["price"]["cadPerPackage"] = round(cal_reg * (float(entry["packageGrams"]) / 100.0), 2)

    return calibrated_db


def save_price_history(history_path: Path, history: dict[str, Any]) -> None:
    """Persist price_history.json atomically via sibling temp file and os.replace."""
    history_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(history, indent=2, ensure_ascii=False) + "\n"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=history_path.parent,
            prefix=f".{history_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp_file:
            tmp_path = Path(tmp_file.name)
            tmp_file.write(payload)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
        os.replace(tmp_path, history_path)
        tmp_path = None
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def run_pipeline(
    output_dir: Path | str | None = None,
    now: dt.datetime | None = None,
    postal_code: str | None = None,
    api_key: str | None = None,
    http_get: Callable[..., dict[str, Any]] | None = None,
    schema_path: Path | str | None = None,
    history_path: Path | str | None = None,
) -> dict[str, Any]:
    """Execute the full Flipp + scoring + Gemini/fallback pipeline and write identical data.json files."""
    root_dir = Path(output_dir) if output_dir is not None else Path(__file__).resolve().parent.parent
    resolved_history_path = Path(history_path) if history_path is not None else root_dir / "price_history.json"
    now_utc = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)

    if schema_path is not None:
        schema = load_nutrition_baseline(schema_path)
        schema_version = str(schema.get("schemaVersion") or SCHEMA_VERSION)
        baseline_prices = {
            k: float(v) for k, v in schema["categoryBaselines"]["baselinePrices"].items()
        }
        unit_weights = {
            k: float(v) for k, v in schema["categoryBaselines"]["defaultUnitWeights"].items()
        }
        goal_presets = copy.deepcopy(schema["goalPresets"])
        base_db = copy.deepcopy(schema["nutritionDb"])
    else:
        schema_version = SCHEMA_VERSION
        baseline_prices = BASELINE_PRICES
        unit_weights = DEFAULT_UNIT_WEIGHTS
        goal_presets = GOAL_PRESETS
        base_db = DEFAULT_NUTRITION_DB

    raw_postal = postal_code or os.environ.get("POSTAL_CODE", DEFAULT_POSTAL_CODE)
    try:
        postal_display = format_postal_display(raw_postal)
        postal_query = normalize_postal_code(raw_postal)
    except ValueError:
        postal_display = DEFAULT_POSTAL_CODE
        postal_query = normalize_postal_code(DEFAULT_POSTAL_CODE)

    items_by_store, flipp_online = fetch_flipp_items(postal_query, http_get=http_get)
    scoring = score_stores(
        items_by_store,
        now=now_utc,
        baseline_prices=baseline_prices,
        default_unit_weights=unit_weights,
    )
    price_source = "flipp" if (flipp_online and scoring["hasLiveDeals"]) else "baseline"

    if price_source == "baseline":
        # Graceful offline/no-deal fallback: score 1.0 across both stores
        scoring["winningStore"] = "Maxi"
        scoring["storeComparison"] = {
            "Maxi": {"weightedScore": 1.0, "proteinScore": 1.0, "carbProduceScore": 1.0, "matchedDeals": 0},
            "Super C": {"weightedScore": 1.0, "proteinScore": 1.0, "carbProduceScore": 1.0, "matchedDeals": 0},
        }
        scoring["flyerPeriod"] = default_flyer_period(now_utc)
        scoring["bestDeals"] = {}
        scoring["bestIngredientDeals"] = {}
        scoring["eggWhitesDeal"] = None

    history = load_and_prune_price_history(resolved_history_path, now_utc)
    if price_source == "flipp":
        upsert_price_observations(
            history,
            postal_display,
            now_utc,
            scoring["bestDealsByStore"],
            scoring["eggWhitesByStore"],
            best_ingredient_deals_by_store=scoring["bestIngredientDealsByStore"],
        )
    history["updatedAt"] = _iso_utc(now_utc)
    calibrated_base_db = calibrate_base_db_from_history(base_db, history, postal_display)

    nutrition_db = build_nutrition_db(
        scoring["bestDeals"],
        egg_whites_deal=scoring["eggWhitesDeal"],
        base_db=calibrated_base_db,
        best_ingredient_deals=scoring["bestIngredientDeals"],
    )

    plan_sections, ai_source = generate_meal_plan(
        winning_store=scoring["winningStore"],
        deals=scoring["bestDeals"],
        flyer_period=scoring["flyerPeriod"],
        api_key=api_key,
    )

    data: dict[str, Any] = {
        "schemaVersion": schema_version,
        "generatedAt": _iso_utc(now_utc),
        "source": f"{ai_source}+{price_source}",
        "location": {
            "postalCodeDisplay": postal_display,
            "postalCodeQuery": postal_query,
            "neighborhood": "Canada",
            "currency": "CAD",
            "groceryTaxRate": 0.0,
        },
        "winningStore": scoring["winningStore"],
        "flyerPeriod": scoring["flyerPeriod"],
        "storeComparison": scoring["storeComparison"],
        "userProfile": {
            **copy.deepcopy(USER_PROFILE),
            "postalCode": postal_display,
        },
        "goalPresets": copy.deepcopy(goal_presets),
        "nutritionDb": nutrition_db,
        "proteinSwaps": copy.deepcopy(PROTEIN_SWAPS),
        "mealTemplates": plan_sections["mealTemplates"],
        "prepTimeline": plan_sections["prepTimeline"],
    }

    sanitize_zero_oil({
        "mealTemplates": data["mealTemplates"],
        "prepTimeline": data["prepTimeline"],
    })

    payload_bytes = (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    for out_path in (root_dir / "data.json", root_dir / "public" / "data.json"):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(payload_bytes)

    save_price_history(resolved_history_path, history)

    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Update grocery flyer and meal plan JSON.")
    parser.add_argument(
        "--schema-file",
        default=None,
        help="Optional path to a custom nutrition_baseline.json schema file.",
    )
    parser.add_argument(
        "--history-file",
        default=None,
        help="Optional path to a custom price_history.json file.",
    )
    if argv is not None:
        args = parser.parse_args(argv)
    else:
        args, _ = parser.parse_known_args()

    run_kwargs: dict[str, Any] = {"schema_path": args.schema_file}
    if args.history_file is not None:
        run_kwargs["history_path"] = args.history_file
    data = run_pipeline(**run_kwargs)
    print(
        f"Updated data.json & public/data.json | source={data['source']} | "
        f"winningStore={data['winningStore']} | "
        f"flyerPeriod={data['flyerPeriod']['validFrom']}..{data['flyerPeriod']['validTo']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
