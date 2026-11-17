"""Weekly Canadian grocery flyer & meal plan pipeline.

Queries Flipp's structured backend API for Maxi (2349) and Super C (2585),
compares stores using a 65% lean protein / 35% carb+produce weighted basket,
optionally customizes seasoning/rotation notes via Google Gemini (google-genai)
with a strict zero-added-oil sanitizer and deterministic fallback, and writes
byte-identical UTF-8 JSON to both `public/data.json` and `./data.json`.
"""

from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
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
FLIPP_SEARCH_URL = "https://backflipp.wishabi.com/flipp/items/search"
FLIPP_ITEM_URL = "https://backflipp.wishabi.com/flipp/items/{item_id}"
DEFAULT_POSTAL_CODE = "H1W"
REQUEST_TIMEOUT_SECONDS = 12
ITEM_DETAIL_TIMEOUT_SECONDS = 5
UPCOMING_FLYER_MAX_HORIZON = dt.timedelta(days=7)

STORES: dict[str, dict[str, Any]] = {
    "Maxi": {"merchant_id": 2349, "aliases": {"maxi"}},
    "Super C": {"merchant_id": 2585, "aliases": {"super c"}},
}

AISLES = ("Produce", "Meat", "Dairy/Eggs", "Pantry/Canned", "Frozen")

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

# Montreal H1W regular baseline prices & historical lows (CAD per 100g)
BASELINE_PRICES: dict[str, float] = {
    "pork": 1.21,
    "chicken": 1.54,
    "canned_fish": 1.35,
    "eggs": 0.70,
    "potatoes": 0.26,
    "rice": 0.45,
    "cabbage": 0.33,
    "cucumbers": 0.57,
    "tomatoes": 0.44,
    "carrots": 0.29,
    "white_beans": 0.42,
}

HISTORICAL_LOWS: dict[str, float] = {
    "pork": 0.39,
    "chicken": 0.66,
    "canned_fish": 0.59,
    "eggs": 0.48,
    "potatoes": 0.09,
    "rice": 0.25,
    "cabbage": 0.15,
    "cucumbers": 0.28,
    "tomatoes": 0.22,
    "carrots": 0.11,
    "white_beans": 0.24,
}

DEFAULT_UNIT_WEIGHTS: dict[str, float] = {
    "cabbage": 900.0,
    "cucumbers": 350.0,
    "tomatoes": 150.0,
    "carrots": 908.0,
    "potatoes": 2268.0,
    "rice": 900.0,
    "white_beans": 540.0,
    "canned_fish": 170.0,
    "pork": 1000.0,
    "chicken": 900.0,
    "eggs": 600.0,
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

GOAL_PRESETS: dict[str, dict[str, Any]] = {
    "cut": {
        "id": "cut",
        "label": "Aggressive Cut",
        "calories": 1900,
        "protein": 200,
        "fat": 50,
        "carbs": 160,
    },
    "recomp": {
        "id": "recomp",
        "label": "Body Recomp",
        "calories": 2400,
        "protein": 175,
        "fat": 80,
        "carbs": 245,
    },
    "maintenance": {
        "id": "maintenance",
        "label": "Maintenance",
        "calories": 2800,
        "protein": 190,
        "fat": 85,
        "carbs": 315,
    },
}

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

# Raw/as-purchased (or drained-edible for canned goods) per-100g nutrition DB.
# ground_chicken MUST stay exactly {calories: 140, protein: 17.0, fat: 9.0, carbs: 0.0}.
DEFAULT_NUTRITION_DB: dict[str, dict[str, Any]] = {
    "whole_egg": {
        "name": "Whole Large Eggs",
        "aisle": "Dairy/Eggs",
        "per100g": {"calories": 143, "protein": 12.6, "fat": 9.5, "carbs": 0.7},
        "cookedYield": 0.90,
        "packageGrams": 600,
        "unitLabel": "dozen",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.67,
            "cadPerPackage": 4.02,
            "regularCadPer100g": 0.67,
            "historicalLowCadPer100g": 0.49,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "egg_whites": {
        "name": "Liquid Egg Whites",
        "aisle": "Dairy/Eggs",
        "per100g": {"calories": 48, "protein": 11.0, "fat": 0.0, "carbs": 0.7},
        "cookedYield": 0.90,
        "packageGrams": 500,
        "unitLabel": "carton",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.80,
            "cadPerPackage": 4.00,
            "regularCadPer100g": 0.80,
            "historicalLowCadPer100g": 0.65,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "potatoes_raw": {
        "name": "Grelot / Baby / Russet Potatoes",
        "aisle": "Produce",
        "per100g": {"calories": 77, "protein": 2.0, "fat": 0.1, "carbs": 17.5},
        "cookedYield": 0.85,
        "packageGrams": 1361,
        "unitLabel": "bag (3 lb)",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.29,
            "cadPerPackage": 3.95,
            "regularCadPer100g": 0.29,
            "historicalLowCadPer100g": 0.15,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "green_onion": {
        "name": "Green Onions / Scallions",
        "aisle": "Produce",
        "per100g": {"calories": 32, "protein": 1.8, "fat": 0.2, "carbs": 7.3},
        "cookedYield": 1.00,
        "packageGrams": 100,
        "unitLabel": "bunch",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 1.29,
            "cadPerPackage": 1.29,
            "regularCadPer100g": 1.29,
            "historicalLowCadPer100g": 0.79,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "pico": {
        "name": "Roma Tomatoes, Onion & Lime (for Pico de Gallo)",
        "aisle": "Produce",
        "per100g": {"calories": 20, "protein": 0.9, "fat": 0.2, "carbs": 4.3},
        "cookedYield": 1.00,
        "packageGrams": 400,
        "unitLabel": "batch (400g)",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.85,
            "cadPerPackage": 3.40,
            "regularCadPer100g": 0.85,
            "historicalLowCadPer100g": 0.55,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "berries": {
        "name": "Mixed Berries (Fresh/Frozen)",
        "aisle": "Frozen",
        "per100g": {"calories": 45, "protein": 0.8, "fat": 0.3, "carbs": 10.5},
        "cookedYield": 1.00,
        "packageGrams": 600,
        "unitLabel": "bag",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.83,
            "cadPerPackage": 4.98,
            "regularCadPer100g": 0.83,
            "historicalLowCadPer100g": 0.58,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "banana": {
        "name": "Banana (Edible)",
        "aisle": "Produce",
        "per100g": {"calories": 89, "protein": 1.1, "fat": 0.3, "carbs": 22.8},
        "cookedYield": 1.00,
        "packageGrams": 600,
        "unitLabel": "bunch",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.22,
            "cadPerPackage": 1.32,
            "regularCadPer100g": 0.22,
            "historicalLowCadPer100g": 0.15,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "ground_chicken": {
        "name": "Walmart Great Value Extra-Lean Ground Chicken",
        "aisle": "Meat",
        "per100g": {"calories": 140, "protein": 17.0, "fat": 9.0, "carbs": 0.0},
        "cookedYield": 0.75,
        "packageGrams": 454,
        "unitLabel": "pack",
        "requiresThaw": True,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 1.10,
            "cadPerPackage": 5.00,
            "regularCadPer100g": 1.10,
            "historicalLowCadPer100g": 0.99,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Walmart Great Value Baseline (454g)",
            "onFlyer": False,
        },
    },
    "tuna_water": {
        "name": "Canned Light Tuna in Water (Drained)",
        "aisle": "Pantry/Canned",
        "per100g": {"calories": 109, "protein": 25.5, "fat": 0.8, "carbs": 0.0},
        "cookedYield": 0.95,
        "packageGrams": 120,
        "unitLabel": "can",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 1.24,
            "cadPerPackage": 1.49,
            "regularCadPer100g": 1.24,
            "historicalLowCadPer100g": 0.83,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "sardines_water": {
        "name": "Canned Sardines in Water/Tomato (Drained)",
        "aisle": "Pantry/Canned",
        "per100g": {"calories": 160, "protein": 22.0, "fat": 8.0, "carbs": 0.0},
        "cookedYield": 1.00,
        "packageGrams": 85,
        "unitLabel": "can",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 1.99,
            "cadPerPackage": 1.69,
            "regularCadPer100g": 1.99,
            "historicalLowCadPer100g": 1.47,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "pork_loin_lean": {
        "name": "Pork Loin / Tenderloin (Trimmed Lean, Raw)",
        "aisle": "Meat",
        "per100g": {"calories": 136, "protein": 21.5, "fat": 4.5, "carbs": 0.0},
        "cookedYield": 0.75,
        "packageGrams": 1000,
        "unitLabel": "kg pack",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 1.10,
            "cadPerPackage": 11.00,
            "regularCadPer100g": 1.10,
            "historicalLowCadPer100g": 0.66,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "pork_shoulder": {
        "name": "Pork Picnic Shoulder (Visibly Trimmed, Raw)",
        "aisle": "Meat",
        "per100g": {"calories": 175, "protein": 19.5, "fat": 10.0, "carbs": 0.0},
        "cookedYield": 0.72,
        "packageGrams": 1500,
        "unitLabel": "roast",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.77,
            "cadPerPackage": 11.55,
            "regularCadPer100g": 0.77,
            "historicalLowCadPer100g": 0.44,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "chicken_breast": {
        "name": "Boneless Skinless Chicken Breast (Raw)",
        "aisle": "Meat",
        "per100g": {"calories": 120, "protein": 22.5, "fat": 2.6, "carbs": 0.0},
        "cookedYield": 0.75,
        "packageGrams": 1000,
        "unitLabel": "kg pack",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 1.43,
            "cadPerPackage": 14.30,
            "regularCadPer100g": 1.43,
            "historicalLowCadPer100g": 0.99,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "white_beans_cnd": {
        "name": "Canned White / Cannellini Beans (Drained)",
        "aisle": "Pantry/Canned",
        "per100g": {"calories": 114, "protein": 7.5, "fat": 0.5, "carbs": 20.5},
        "cookedYield": 1.00,
        "packageGrams": 340,
        "unitLabel": "can",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.50,
            "cadPerPackage": 1.70,
            "regularCadPer100g": 0.50,
            "historicalLowCadPer100g": 0.29,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "diced_tomatoes": {
        "name": "Canned Diced Tomatoes (No Oil)",
        "aisle": "Pantry/Canned",
        "per100g": {"calories": 21, "protein": 0.9, "fat": 0.1, "carbs": 4.4},
        "cookedYield": 0.90,
        "packageGrams": 796,
        "unitLabel": "can",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.25,
            "cadPerPackage": 1.99,
            "regularCadPer100g": 0.25,
            "historicalLowCadPer100g": 0.16,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "rice_dry": {
        "name": "Long-Grain / Jasmine White Rice (Dry)",
        "aisle": "Pantry/Canned",
        "per100g": {"calories": 360, "protein": 7.0, "fat": 0.6, "carbs": 79.0},
        "cookedYield": 2.80,
        "packageGrams": 2000,
        "unitLabel": "bag (2 kg)",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.30,
            "cadPerPackage": 6.00,
            "regularCadPer100g": 0.30,
            "historicalLowCadPer100g": 0.20,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "cabbage": {
        "name": "Green Cabbage (Shredded, Raw)",
        "aisle": "Produce",
        "per100g": {"calories": 25, "protein": 1.3, "fat": 0.1, "carbs": 5.8},
        "cookedYield": 1.00,
        "packageGrams": 900,
        "unitLabel": "head",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.28,
            "cadPerPackage": 2.52,
            "regularCadPer100g": 0.28,
            "historicalLowCadPer100g": 0.14,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "cucumber": {
        "name": "English Cucumber (Raw)",
        "aisle": "Produce",
        "per100g": {"calories": 15, "protein": 0.7, "fat": 0.1, "carbs": 3.6},
        "cookedYield": 1.00,
        "packageGrams": 350,
        "unitLabel": "each",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.57,
            "cadPerPackage": 2.00,
            "regularCadPer100g": 0.57,
            "historicalLowCadPer100g": 0.28,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "carrots": {
        "name": "Carrots (Raw)",
        "aisle": "Produce",
        "per100g": {"calories": 41, "protein": 0.9, "fat": 0.2, "carbs": 9.6},
        "cookedYield": 1.00,
        "packageGrams": 907,
        "unitLabel": "bag (2 lb)",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.28,
            "cadPerPackage": 2.54,
            "regularCadPer100g": 0.28,
            "historicalLowCadPer100g": 0.14,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "edamame": {
        "name": "Shelled Edamame (Frozen)",
        "aisle": "Frozen",
        "per100g": {"calories": 121, "protein": 11.9, "fat": 5.2, "carbs": 8.9},
        "cookedYield": 1.00,
        "packageGrams": 400,
        "unitLabel": "bag",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.87,
            "cadPerPackage": 3.48,
            "regularCadPer100g": 0.87,
            "historicalLowCadPer100g": 0.62,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "corn": {
        "name": "Corn Kernels (Frozen)",
        "aisle": "Frozen",
        "per100g": {"calories": 86, "protein": 3.3, "fat": 1.2, "carbs": 19.0},
        "cookedYield": 1.00,
        "packageGrams": 500,
        "unitLabel": "bag",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.50,
            "cadPerPackage": 2.50,
            "regularCadPer100g": 0.50,
            "historicalLowCadPer100g": 0.35,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "tzatziki_0": {
        "name": "0% Greek Yogurt + Cucumber/Garlic/Lemon (for Tzatziki)",
        "aisle": "Dairy/Eggs",
        "per100g": {"calories": 55, "protein": 8.0, "fat": 0.2, "carbs": 4.5},
        "cookedYield": 1.00,
        "packageGrams": 500,
        "unitLabel": "yogurt + veg (500g)",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.90,
            "cadPerPackage": 4.50,
            "regularCadPer100g": 0.90,
            "historicalLowCadPer100g": 0.65,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "skyr_0": {
        "name": "Siggi's 0% Plain Skyr",
        "aisle": "Dairy/Eggs",
        "per100g": {"calories": 63, "protein": 10.9, "fat": 0.2, "carbs": 4.0},
        "cookedYield": 1.00,
        "packageGrams": 750,
        "unitLabel": "tub",
        "requiresThaw": False,
        "pantryDefault": False,
        "price": {
            "cadPer100g": 0.80,
            "cadPerPackage": 6.00,
            "regularCadPer100g": 0.80,
            "historicalLowCadPer100g": 0.53,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Montreal H1W Regular Baseline",
            "onFlyer": False,
        },
    },
    "whey_isolate": {
        "name": "Whey Protein Isolate",
        "aisle": "Pantry/Canned",
        "per100g": {"calories": 370, "protein": 86.7, "fat": 1.0, "carbs": 3.3},
        "cookedYield": 1.00,
        "packageGrams": 900,
        "unitLabel": "tub",
        "requiresThaw": False,
        "pantryDefault": True,
        "price": {
            "cadPer100g": 3.89,
            "cadPerPackage": 35.01,
            "regularCadPer100g": 3.89,
            "historicalLowCadPer100g": 2.99,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Pantry Protein Tub Baseline",
            "onFlyer": False,
        },
    },
    "aromatics_zero": {
        "name": "Ginger / Garlic / Onion / Spices / Broth",
        "aisle": "Produce",
        "per100g": {"calories": 0, "protein": 0.0, "fat": 0.0, "carbs": 0.0},
        "cookedYield": 1.00,
        "packageGrams": 250,
        "unitLabel": "bundle",
        "requiresThaw": False,
        "pantryDefault": True,
        "price": {
            "cadPer100g": 0.40,
            "cadPerPackage": 1.00,
            "regularCadPer100g": 0.40,
            "historicalLowCadPer100g": 0.25,
            "savingsPct": 0,
            "radarTag": "REGULAR",
            "flyerItemName": "Aromatics & Broth Baseline",
            "onFlyer": False,
        },
    },
}

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

SAFE_NEGATION_RE = re.compile(
    r"\b(?:0\s*g|zero|no|without|sans)\s+(?:added\s+)?(?:cooking\s+)?(?:oil|huile)\b|\boil[- ]free\b",
    re.IGNORECASE,
)

ADDED_OIL_RE = re.compile(
    r"\b(oils?|oily|oiled|huiles?|butters?|buttered|buttery|beurres?|ghees?|tallows?|lards?|shortenings?|margarines?|sprays?|sprayed|pam)\b",
    re.IGNORECASE,
)


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
                weight_grams = DEFAULT_UNIT_WEIGHTS.get(subcategory, 500.0)

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
) -> dict[str, Any]:
    """Score Maxi vs Super C using 65% protein / 35% carb+produce weights and select one winner."""
    now_utc = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    store_comparison: dict[str, dict[str, Any]] = {}
    best_deals_by_store: dict[str, dict[str, dict[str, Any]]] = {}
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
        matched_deals = 0
        best_egg_whites: dict[str, Any] | None = None

        # Route liquid egg whites separately if present
        for item in active_items:
            name = str(item.get("name") or "")
            desc = str(item.get("description") or "")
            if is_egg_whites_item(name, desc):
                detail_fetcher = item.get("_detail_fetcher")
                cad100, pkg_g, unit_note = parse_unit_price_per_100g(item, "eggs", detail_fetcher=detail_fetcher)
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
                cad100, pkg_g, unit_note = parse_unit_price_per_100g(item, subcat, detail_fetcher=detail_fetcher)
                if cad100 is None:
                    continue
                candidates.append({
                    "name": name.replace("\xa0", " ").strip(),
                    "cadPer100g": cad100,
                    "packageGrams": pkg_g or DEFAULT_UNIT_WEIGHTS.get(subcat, 500.0),
                    "unitNote": unit_note,
                    "raw": item,
                })
            if candidates:
                best = min(candidates, key=lambda c: c["cadPer100g"])
                best_by_cat[subcat] = best
                matched_deals += 1
                any_matched_deals = True

        protein_sum = 0.0
        for subcat, weight in PROTEIN_WEIGHTS.items():
            price = best_by_cat[subcat]["cadPer100g"] if subcat in best_by_cat else BASELINE_PRICES[subcat]
            protein_sum += weight * (price / BASELINE_PRICES[subcat])
        protein_score = round(protein_sum / 0.65, 4)

        carb_sum = 0.0
        for subcat, weight in CARB_PRODUCE_WEIGHTS.items():
            price = best_by_cat[subcat]["cadPer100g"] if subcat in best_by_cat else BASELINE_PRICES[subcat]
            carb_sum += weight * (price / BASELINE_PRICES[subcat])
        carb_produce_score = round(carb_sum / 0.35, 4)

        weighted_score = round(0.65 * protein_score + 0.35 * carb_produce_score, 4)
        store_comparison[store] = {
            "weightedScore": weighted_score,
            "proteinScore": protein_score,
            "carbProduceScore": carb_produce_score,
            "matchedDeals": matched_deals,
        }
        best_deals_by_store[store] = best_by_cat
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


def build_nutrition_db(
    best_deals: dict[str, dict[str, Any]],
    egg_whites_deal: dict[str, Any] | None = None,
    ground_chicken_override: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Build all 25 nutritionDb entries, applying winning-store flyer deals while isolating ground_chicken."""
    db = copy.deepcopy(DEFAULT_NUTRITION_DB)

    if "pork" in best_deals:
        pork_deal = best_deals["pork"]
        folded_pork = fold_accents(pork_deal["name"])
        if any(k in folded_pork for k in ("epaule", "picnic", "shoulder")):
            _apply_deal_price(db["pork_shoulder"], pork_deal)
        elif any(k in folded_pork for k in ("filet", "longe", "loin", "tenderloin")):
            _apply_deal_price(db["pork_loin_lean"], pork_deal)
        else:
            _apply_deal_price(db["pork_loin_lean"], pork_deal)

    if "chicken" in best_deals:
        chicken_deal = best_deals["chicken"]
        folded_chx = fold_accents(chicken_deal["name"])
        if any(k in folded_chx for k in ("poitrine", "breast", "filet")):
            _apply_deal_price(db["chicken_breast"], chicken_deal)

    if "canned_fish" in best_deals:
        fish_deal = best_deals["canned_fish"]
        folded_fish = fold_accents(fish_deal["name"])
        if "sardine" in folded_fish:
            _apply_deal_price(db["sardines_water"], fish_deal)
        else:
            _apply_deal_price(db["tuna_water"], fish_deal)

    if "eggs" in best_deals:
        _apply_deal_price(db["whole_egg"], best_deals["eggs"])

    if egg_whites_deal is not None:
        _apply_deal_price(db["egg_whites"], egg_whites_deal)

    direct_map = {
        "potatoes": "potatoes_raw",
        "rice": "rice_dry",
        "cabbage": "cabbage",
        "cucumbers": "cucumber",
        "carrots": "carrots",
        "white_beans": "white_beans_cnd",
    }
    for subcat, db_key in direct_map.items():
        if subcat in best_deals:
            _apply_deal_price(db[db_key], best_deals[subcat])

    if "tomatoes" in best_deals:
        tom_deal = best_deals["tomatoes"]
        folded_tom = fold_accents(tom_deal["name"])
        if any(
            k in folded_tom
            for k in (
                "en des", "diced", "coulis", "strained", "broye", "broyees",
                "crushed", "entieres", "796", "680", "540",
                "aylmer", "primo", "unico", "aurora",
            )
        ):
            _apply_deal_price(db["diced_tomatoes"], tom_deal)
        else:
            _apply_deal_price(db["pico"], tom_deal)

    # ground_chicken stays strictly isolated at Walmart Great Value baseline unless explicitly overridden
    if ground_chicken_override:
        _apply_deal_price(db["ground_chicken"], ground_chicken_override)

    return db


def contains_added_oil(text: str | None) -> bool:
    """Return True if text mentions added oils/fats (allowing boil/broil/foil/tenderloin and 0g oil/oil-free)."""
    if not isinstance(text, str):
        return False
    cleaned = SAFE_NEGATION_RE.sub(" ", text)
    return bool(ADDED_OIL_RE.search(cleaned))


# Alias matching Explorer 3 naming
contains_banned_oil = contains_added_oil


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


def run_pipeline(
    output_dir: Path | str | None = None,
    now: dt.datetime | None = None,
    postal_code: str | None = None,
    api_key: str | None = None,
    http_get: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute the full Flipp + scoring + Gemini/fallback pipeline and write identical data.json files."""
    root_dir = Path(output_dir) if output_dir is not None else Path(__file__).resolve().parent.parent
    now_utc = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)

    raw_postal = postal_code or os.environ.get("POSTAL_CODE", DEFAULT_POSTAL_CODE)
    try:
        postal_display = format_postal_display(raw_postal)
        postal_query = normalize_postal_code(raw_postal)
    except ValueError:
        postal_display = DEFAULT_POSTAL_CODE
        postal_query = normalize_postal_code(DEFAULT_POSTAL_CODE)

    items_by_store, flipp_online = fetch_flipp_items(postal_query, http_get=http_get)
    scoring = score_stores(items_by_store, now=now_utc)
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
        scoring["eggWhitesDeal"] = None

    nutrition_db = build_nutrition_db(
        scoring["bestDeals"],
        egg_whites_deal=scoring["eggWhitesDeal"],
    )

    plan_sections, ai_source = generate_meal_plan(
        winning_store=scoring["winningStore"],
        deals=scoring["bestDeals"],
        flyer_period=scoring["flyerPeriod"],
        api_key=api_key,
    )

    data: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": now_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
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
        "goalPresets": copy.deepcopy(GOAL_PRESETS),
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

    return data


def main() -> int:
    data = run_pipeline()
    print(
        f"Updated data.json & public/data.json | source={data['source']} | "
        f"winningStore={data['winningStore']} | "
        f"flyerPeriod={data['flyerPeriod']['validFrom']}..{data['flyerPeriod']['validTo']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
