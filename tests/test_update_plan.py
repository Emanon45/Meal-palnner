"""Comprehensive unit and end-to-end tests for scripts/update_plan.py."""

from __future__ import annotations

import copy
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
for p in (str(ROOT_DIR), str(SCRIPTS_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

import update_plan  # noqa: E402


EXPECTED_NUTRITION_KEYS = {
    "whole_egg",
    "egg_whites",
    "potatoes_raw",
    "green_onion",
    "pico",
    "berries",
    "banana",
    "ground_chicken",
    "tuna_water",
    "sardines_water",
    "pork_loin_lean",
    "pork_shoulder",
    "chicken_breast",
    "white_beans_cnd",
    "diced_tomatoes",
    "rice_dry",
    "cabbage",
    "cucumber",
    "carrots",
    "edamame",
    "corn",
    "tzatziki_0",
    "skyr_0",
    "whey_isolate",
    "aromatics_zero",
}


def _make_flipp_item(
    item_id: int,
    name: str,
    merchant: str,
    price: float | None,
    post_price_text: str | None = None,
    pre_price_text: str | None = None,
    sale_story: str | None = None,
    valid_from: str = "2026-11-12T05:00:00+00:00",
    valid_to: str = "2026-11-19T04:59:59+00:00",
    item_type: str | None = "flyer",
    description: str | None = None,
) -> dict:
    merchant_id = {"Maxi": 2349, "Super C": 2585, "Walmart": 2340}.get(merchant, 9999)
    item = {
        "id": item_id,
        "flyer_item_id": item_id,
        "name": name,
        "merchant_id": merchant_id,
        "merchant_name": merchant,
        "current_price": price,
        "pre_price_text": pre_price_text,
        "post_price_text": post_price_text,
        "sale_story": sale_story,
        "valid_from": valid_from,
        "valid_to": valid_to,
        "item_type": item_type,
    }
    if description is not None:
        item["description"] = description
    return item


class TestFlippNormalizationAndFiltering(unittest.TestCase):
    def test_normalize_postal_code_h1w_variants(self) -> None:
        self.assertEqual(update_plan.normalize_postal_code("H1W"), "H1W1A1")
        self.assertEqual(update_plan.normalize_postal_code("h1w"), "H1W1A1")
        self.assertEqual(update_plan.normalize_postal_code("h1w 1a1"), "H1W1A1")
        self.assertEqual(update_plan.normalize_postal_code("H1W-1A1"), "H1W1A1")
        self.assertEqual(update_plan.format_postal_display("H1W"), "H1W")
        self.assertEqual(update_plan.format_postal_display("H1W 1A1"), "H1W")
        with self.assertRaises(ValueError):
            update_plan.normalize_postal_code("12345")

    def test_overlapping_flyer_weeks_and_montreal_timezone_boundary(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        items = [
            _make_flipp_item(
                1,
                "FILET DE PORC",
                "Maxi",
                3.49,
                post_price_text="/lb",
                valid_from="2026-11-12T05:00:00+00:00",
                valid_to="2026-11-19T04:59:59+00:00",
            ),
            _make_flipp_item(
                2,
                "FILET DE PORC",
                "Maxi",
                1.99,
                post_price_text="/lb",
                valid_from="2026-11-19T05:00:00+00:00",
                valid_to="2026-11-26T04:59:59+00:00",
            ),
        ]
        selected, period = update_plan.select_active_flyer_items(items, now=now)
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["id"], 1)
        # 2026-11-19T04:59:59+00:00 in Montreal EST (-05:00) is 2026-11-18T23:59:59-05:00
        self.assertEqual(period, {"validFrom": "2026-11-12", "validTo": "2026-11-18"})

    def test_upcoming_flyer_fallback_when_no_active_items(self) -> None:
        now = dt.datetime(2026, 11, 11, 13, 0, 0, tzinfo=dt.timezone.utc)
        items = [
            _make_flipp_item(
                10,
                "POITRINE DE POULET",
                "Super C",
                4.49,
                post_price_text="/lb",
                valid_from="2026-11-12T05:00:00+00:00",
                valid_to="2026-11-19T04:59:59+00:00",
            ),
            _make_flipp_item(
                11,
                "POITRINE DE POULET",
                "Super C",
                2.99,
                post_price_text="/lb",
                valid_from="2026-11-19T05:00:00+00:00",
                valid_to="2026-11-26T04:59:59+00:00",
            ),
        ]
        selected, period = update_plan.select_active_flyer_items(items, now=now)
        self.assertEqual([it["id"] for it in selected], [10])
        self.assertEqual(period["validFrom"], "2026-11-12")

    def test_far_future_upcoming_items_excluded_while_near_upcoming_selected(self) -> None:
        now = dt.datetime(2026, 11, 11, 13, 0, 0, tzinfo=dt.timezone.utc)
        far_future = _make_flipp_item(
            20,
            "POITRINE DE POULET FUTURE",
            "Super C",
            0.01,
            post_price_text="/lb",
            valid_from="2099-01-01T05:00:00+00:00",
            valid_to="2099-01-08T04:59:59+00:00",
        )
        selected_only_far, period_only_far = update_plan.select_active_flyer_items([far_future], now=now)
        self.assertEqual(selected_only_far, [])
        self.assertEqual(period_only_far, update_plan.default_flyer_period(now))

        near_upcoming = _make_flipp_item(
            21,
            "FILET DE PORC",
            "Maxi",
            3.49,
            post_price_text="/lb",
            valid_from="2026-11-12T05:00:00+00:00",
            valid_to="2026-11-19T04:59:59+00:00",
        )
        selected_mixed, period_mixed = update_plan.select_active_flyer_items(
            [far_future, near_upcoming],
            now=now,
        )
        self.assertEqual([it["id"] for it in selected_mixed], [21])
        self.assertEqual(period_mixed, {"validFrom": "2026-11-12", "validTo": "2026-11-18"})

    def test_expired_flyer_items_excluded(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        expired_and_inverted_items = [
            _make_flipp_item(
                30,
                "LONGE DE PORC EXPIRED",
                "Super C",
                0.01,
                post_price_text="/lb",
                valid_from="2020-01-02T05:00:00+00:00",
                valid_to="2020-01-09T04:59:59+00:00",
            ),
            _make_flipp_item(
                31,
                "POITRINE DE POULET JUST EXPIRED",
                "Maxi",
                0.50,
                post_price_text="/lb",
                valid_from="2026-11-10T05:00:00+00:00",
                valid_to="2026-11-17T12:59:59+00:00",
            ),
            _make_flipp_item(
                32,
                "POITRINE DE POULET INVERTED",
                "Super C",
                0.01,
                post_price_text="/lb",
                valid_from="2026-11-18T05:00:00+00:00",
                valid_to="2026-11-12T05:00:00+00:00",
            ),
        ]
        selected, period = update_plan.select_active_flyer_items(expired_and_inverted_items, now=now)
        self.assertEqual(selected, [])
        self.assertEqual(period, update_plan.default_flyer_period(now))

    def test_bilingual_en_fr_and_ligature_matching(self) -> None:
        self.assertFalse(update_plan.is_excluded_item("CHOU VERT", "cabbage"))
        self.assertFalse(update_plan.is_excluded_item("CUISSES DE POULET AVEC DOS", "chicken"))
        self.assertFalse(update_plan.is_excluded_item("CONCOMBRES ANGLAIS", "cucumbers"))
        self.assertFalse(update_plan.is_excluded_item("FILET DE PORC FRAIS", "pork"))
        self.assertFalse(
            update_plan.is_excluded_item(
                "épaule picnic de porc frais | fresh pork picnic shoulder",
                "pork",
            )
        )
        self.assertFalse(update_plan.is_excluded_item("OEUFS BLANCS SELECTION", "eggs"))
        self.assertFalse(update_plan.is_excluded_item("ŒUFS GROS CALIBRE 12 UN.", "eggs"))
        self.assertFalse(update_plan.is_excluded_item("légumineuses Cedar | Cedar legumes", "white_beans"))
        self.assertFalse(update_plan.is_excluded_item("FÈVES MENU BLEU PC 900 G", "white_beans"))

    def test_negative_keyword_false_positives_and_counter_examples(self) -> None:
        traps = [
            ("CHOU-FLEUR | CAULIFLOWER", "cabbage"),
            ("CHOUX DE BRUXELLES", "cabbage"),
            ("FRITES SURGELÉES MCCAIN", "potatoes"),
            ("pommes de terre frites Cavendish", "potatoes"),
            ("SANDWICHS AUX OEUFS", "eggs"),
            ("SANDWICHS OU BOUCHÉES AUX ŒUFS", "eggs"),
            ("Selection egg rolls", "eggs"),
            ("BLANCS D'ŒUFS PC MENU BLE, 1 KG", "eggs"),
            ("CRAQUELINS DE RIZ", "rice"),
            ("Riz Bistro Express Ben's Original", "rice"),
            ("HARICOTS FRANÇAIS, 400 G", "white_beans"),
            ("HARICOTS VERTS", "white_beans"),
            ("SARDINES EN SAUCE TOMATE", "tomatoes"),
            ("SOUPE AUX TOMATES AYLMER", "tomatoes"),
            ("SAUCISSES DE PORC", "pork"),
            ("CÔTES DE DOS DE PORC", "pork"),
            ("ailles de poulet frais", "chicken"),
            ("pilons de poulet panés", "chicken"),
            ("SURIMI 227 G OU CREVETTES", "canned_fish"),
            ("DARNE DE THON JAUNE 92 G", "canned_fish"),
            ("THON PALE DANS L'HUILE 170G", "canned_fish"),
            ("THON PALE DANS L\u2019HUILE 170G", "canned_fish"),
            ("SARDINES A L'HUILE 106 G", "canned_fish"),
            ("TUNA IN OIL 170 G", "canned_fish"),
            ("BLANCS D\u2019\u0152UFS PC MENU BLEU", "eggs"),
            ("BLANCS D\u2018\u0152UFS PC MENU BLEU", "eggs"),
            ("BLANCS D\u02bc\u0152UFS PC MENU BLEU", "eggs"),
        ]
        for name, subcat in traps:
            with self.subTest(name=name, subcat=subcat):
                self.assertTrue(update_plan.is_excluded_item(name, subcat))

        # Positive counter-examples that MUST pass
        self.assertFalse(
            update_plan.is_excluded_item(
                "Pommes de terre purée, frite, salade Parfaite | Parfaite potatoes",
                "potatoes",
            )
        )
        self.assertFalse(update_plan.is_excluded_item("THON PÂLE SANS NOM 85/170 G", "canned_fish"))
        self.assertFalse(update_plan.is_excluded_item("SARDINES BRUNSWICK EN SAUCE TOMATE 106 G", "canned_fish"))
        self.assertTrue(update_plan.is_egg_whites_item("BLANCS D'ŒUFS PC MENU BLE, 1 KG"))
        self.assertTrue(update_plan.is_egg_whites_item("BLANCS D\u2019\u0152UFS PC MENU BLEU"))
        self.assertTrue(update_plan.is_egg_whites_item("BLANCS D\u2018\u0152UFS PC MENU BLEU"))
        self.assertTrue(update_plan.is_egg_whites_item("BLANCS D\u02bc\u0152UFS PC MENU BLEU"))

    def test_pork_egg_rolls_excluded_while_legitimate_cuts_match(self) -> None:
        excluded_pork_items = (
            "EGG ROLLS AU PORC",
            "Pork Egg Rolls",
            "Rouleaux impériaux au porc",
        )
        for name in excluded_pork_items:
            with self.subTest(excluded=name, subcat="pork"):
                self.assertTrue(update_plan.is_excluded_item(name, "pork"))

        with self.subTest(excluded="EGG ROLLS AU POULET", subcat="chicken"):
            self.assertTrue(update_plan.is_excluded_item("EGG ROLLS AU POULET", "chicken"))

        legitimate_pork_cuts = (
            "FILET DE PORC FRAIS",
            "LONGE DE PORC DESOSSEE",
            "ÉPAULE PICNIC DE PORC FRAIS",
            "Pork Loin Roast",
            "Fresh Pork Picnic Shoulder",
            "rôti de longe de porc",
        )
        for name in legitimate_pork_cuts:
            with self.subTest(legitimate=name):
                self.assertFalse(update_plan.is_excluded_item(name, "pork"))

        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        scored = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(901, "EGG ROLLS AU PORC", "Maxi", 1.99),
                    _make_flipp_item(902, "FILET DE PORC", "Maxi", 2.99, post_price_text="/lb"),
                ],
                "Super C": [
                    _make_flipp_item(903, "Rouleaux impériaux au porc", "Super C", 1.50),
                ],
            },
            now=now,
        )
        self.assertEqual(scored["winningStore"], "Maxi")
        self.assertEqual(scored["bestDeals"]["pork"]["name"], "FILET DE PORC")
        self.assertEqual(scored["storeComparison"]["Super C"]["matchedDeals"], 0)

    def test_unit_price_parsing_edge_cases(self) -> None:
        # /lb
        c1, g1, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(1, "FILET DE PORC", "Maxi", 2.99, post_price_text="/lb"),
            "pork",
        )
        self.assertAlmostEqual(c1, 2.99 / 4.5359237, places=3)
        self.assertEqual(g1, 454.0)

        # /lb - 7,34$/kg prioritizes /lb because current_price is the /lb price
        c2, _, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(2, "POITRINE DE POULET", "Maxi", 3.33, post_price_text="/lb - 7,34$/kg"),
            "chicken",
        )
        self.assertAlmostEqual(c2, 3.33 / 4.5359237, places=3)

        # /kg
        c3, g3, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(3, "PORC HACHÉ", "Super C", 7.50, post_price_text="/kg"),
            "pork",
        )
        self.assertAlmostEqual(c3, 0.75, places=3)
        self.assertEqual(g3, 1000.0)

        # /100g
        c4, g4, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(4, "FILET", "Maxi", 0.99, post_price_text="/100g"),
            "pork",
        )
        self.assertAlmostEqual(c4, 0.99, places=3)
        self.assertEqual(g4, 100.0)

        # Missing post_price_text with SAC DE 10 LB
        c5, g5, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(5, "POMMES DE TERRE SAC DE 10 LB", "Maxi", 4.99, post_price_text=None),
            "potatoes",
        )
        self.assertAlmostEqual(c5, 4.99 / 45.359237, places=3)
        self.assertGreater(g5, 4500)

        # Slash range 85/170 G and multiplier 2x170g
        c6, g6, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(6, "THON PÂLE SANS NOM 85/170 G", "Maxi", 1.25),
            "canned_fish",
        )
        self.assertEqual(g6, 170.0)
        self.assertAlmostEqual(c6, 1.25 / 1.7, places=3)

        c7, g7, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(7, "THON EN EAU 2x170g", "Super C", 2.50),
            "canned_fish",
        )
        self.assertEqual(g7, 340.0)
        self.assertAlmostEqual(c7, 2.50 / 3.4, places=3)

        # Multi-buy pre_price_text "3/" with description 540 ml (\xa0)
        c8, g8, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(
                8,
                "légumineuses Cedar",
                "Super C",
                3.97,
                pre_price_text="3/",
                post_price_text="ou 1,33$ l'unité",
                description="540\xa0ml, choix varié",
            ),
            "white_beans",
        )
        self.assertEqual(g8, 540.0)
        self.assertAlmostEqual(c8, (3.97 / 3.0) / 5.4, places=3)

        # sale_story $/lb fallback
        c9, _, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(
                9,
                "hauts de cuisse de poulet désossés halal",
                "Super C",
                7.97,
                sale_story="d'économie 1.02$/lb",
            ),
            "chicken",
        )
        self.assertAlmostEqual(c9, 7.97 / 4.5359237, places=3)

        # Eggs: 18 eggs vs default 12 (with flyer typo doux.)
        c10, g10, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(10, "OEUFS GROS 18 UN.", "Maxi", 5.40),
            "eggs",
        )
        self.assertEqual(g10, 900.0)
        self.assertAlmostEqual(c10, 0.60, places=3)

        c11, g11, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(11, "oeufs blancs Selection", "Super C", 3.00, description="calibre gros, doux."),
            "eggs",
        )
        self.assertEqual(g11, 600.0)
        self.assertAlmostEqual(c11, 0.50, places=3)

        # Produce unit count: 6 UN. mini cucumbers
        c12, g12, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(12, "MINI CONCOMBRES 6 UN.", "Super C", 3.00),
            "cucumbers",
        )
        self.assertEqual(g12, 600.0)
        self.assertAlmostEqual(c12, 0.50, places=3)

        # Missing or non-finite current_price safely ignored
        c13, g13, note13 = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(13, "FILET DE PORC", "Maxi", None),
            "pork",
        )
        self.assertIsNone(c13)
        self.assertIsNone(g13)
        self.assertEqual(note13, "")

        for bad_price in (float("nan"), float("inf"), float("-inf"), "nan", "inf", "-inf"):
            with self.subTest(bad_price=bad_price):
                cb, gb, nb = update_plan.parse_unit_price_per_100g(
                    _make_flipp_item(14, "PORC", "Maxi", bad_price, post_price_text="/lb"),
                    "pork",
                )
                self.assertIsNone(cb)
                self.assertIsNone(gb)
                self.assertEqual(nb, "")

    def test_post_price_text_multi_unit_weights_vs_explicit_rates(self) -> None:
        # Multi-unit package weights in post_price_text MUST NOT be misread as /lb or /kg
        c_3lb, g_3lb, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(21, "POMMES DE TERRE", "Maxi", 4.99, post_price_text="3 lb"),
            "potatoes",
        )
        self.assertAlmostEqual(c_3lb, 4.99 / (3 * 4.5359237), places=4)
        self.assertAlmostEqual(g_3lb, 1360.78, places=2)

        c_sac2lb, g_sac2lb, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(22, "CAROTTES", "Super C", 2.99, post_price_text="sac 2 lb"),
            "carrots",
        )
        self.assertAlmostEqual(c_sac2lb, 2.99 / (2 * 4.5359237), places=4)
        self.assertAlmostEqual(g_sac2lb, 907.18, places=2)

        c_2kg, g_2kg, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(23, "RIZ BLANC", "Maxi", 6.00, post_price_text="2 kg"),
            "rice",
        )
        self.assertAlmostEqual(c_2kg, 0.30, places=4)
        self.assertEqual(g_2kg, 2000.0)

        # Explicit rates (/lb, bare lb, /lb - 7,34$/kg, per lb, par kg) MUST still parse as unit rates
        for post_txt in ("/lb", "lb", "/lb - 7,34$/kg", "per lb"):
            with self.subTest(post_txt=post_txt):
                cr, gr, note = update_plan.parse_unit_price_per_100g(
                    _make_flipp_item(24, "FILET DE PORC", "Maxi", 2.99, post_price_text=post_txt),
                    "pork",
                )
                self.assertAlmostEqual(cr, 2.99 / 4.5359237, places=4)
                self.assertEqual(gr, 454.0)
                self.assertEqual(note, "/lb")

        # Detail enrichment fallback also respects multi-unit post weight ("3 lb") vs "/lb"
        c_det_pkg, g_det_pkg, _ = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(25, "POMMES DE TERRE", "Maxi", 4.99),
            "potatoes",
            detail_fetcher=lambda _id: {"price_text": "3 lb", "description": ""},
        )
        self.assertAlmostEqual(c_det_pkg, 4.99 / (3 * 4.5359237), places=4)
        self.assertAlmostEqual(g_det_pkg, 1360.78, places=2)

        c_det_rate, g_det_rate, note_det_rate = update_plan.parse_unit_price_per_100g(
            _make_flipp_item(26, "FILET DE PORC", "Maxi", 3.99),
            "pork",
            detail_fetcher=lambda _id: {"price_text": "/lb", "description": ""},
        )
        self.assertAlmostEqual(c_det_rate, 3.99 / 4.5359237, places=4)
        self.assertEqual(g_det_rate, 454.0)
        self.assertEqual(note_det_rate, "/lb")


class TestStoreScoringAndPriceRadar(unittest.TestCase):
    def test_weighted_65_35_scoring_protein_dominates(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        # Super C is much cheaper on all 4 proteins (65% weight)
        # Maxi is cheaper on all 7 carbs/produce (35% weight)
        items_by_store = {
            "Super C": [
                _make_flipp_item(1, "FILET DE PORC", "Super C", 2.00, post_price_text="/lb"),
                _make_flipp_item(2, "POITRINE DE POULET", "Super C", 2.99, post_price_text="/lb"),
                _make_flipp_item(3, "THON EN EAU 170G", "Super C", 1.00),
                _make_flipp_item(4, "OEUFS GROS 12 UN.", "Super C", 2.88),
                _make_flipp_item(5, "POMMES DE TERRE 5 LB", "Super C", 5.50),
                _make_flipp_item(6, "RIZ BLANC 2 KG", "Super C", 8.50),
            ],
            "Maxi": [
                _make_flipp_item(11, "FILET DE PORC", "Maxi", 5.20, post_price_text="/lb"),
                _make_flipp_item(12, "POITRINE DE POULET", "Maxi", 6.50, post_price_text="/lb"),
                _make_flipp_item(13, "POMMES DE TERRE 10 LB", "Maxi", 3.50),
                _make_flipp_item(14, "RIZ JASMIN 2 KG", "Maxi", 4.50),
                _make_flipp_item(15, "CHOU VERT", "Maxi", 0.59, post_price_text="/lb"),
                _make_flipp_item(16, "CONCOMBRES ANGLAIS", "Maxi", 0.89),
                _make_flipp_item(17, "TOMATES ROMA", "Maxi", 0.99, post_price_text="/lb"),
                _make_flipp_item(18, "CAROTTES 2 LB", "Maxi", 1.29),
                _make_flipp_item(19, "LÉGUMINEUSES CEDAR 540 ML", "Maxi", 1.19),
            ],
        }
        result = update_plan.score_stores(items_by_store, now=now)
        self.assertEqual(result["winningStore"], "Super C")
        self.assertLess(
            result["storeComparison"]["Super C"]["weightedScore"],
            result["storeComparison"]["Maxi"]["weightedScore"],
        )

    def test_missing_subcategory_uses_baseline_fallback(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        items_by_store = {
            "Maxi": [
                _make_flipp_item(1, "CHOU VERT", "Maxi", 0.50, post_price_text="/lb"),
            ],
            "Super C": [
                _make_flipp_item(2, "FILET DE PORC", "Super C", 2.49, post_price_text="/lb"),
                _make_flipp_item(3, "POITRINE DE POULET", "Super C", 3.49, post_price_text="/lb"),
                _make_flipp_item(4, "THON PÂLE 170 G", "Super C", 1.10),
                _make_flipp_item(5, "OEUFS 12 UN.", "Super C", 2.99),
            ],
        }
        result = update_plan.score_stores(items_by_store, now=now)
        self.assertEqual(result["winningStore"], "Super C")
        self.assertEqual(result["storeComparison"]["Maxi"]["matchedDeals"], 1)
        self.assertEqual(result["storeComparison"]["Maxi"]["proteinScore"], 1.0)

    def test_active_store_beats_far_future_2099_and_near_upcoming_other_store(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        # Maxi active vs Super C expired (2020) + far-future (2099)
        scored = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(1, "LONGE DE PORC", "Maxi", 3.49, post_price_text="/lb"),
                    _make_flipp_item(2, "POITRINE DE POULET", "Maxi", 4.99, post_price_text="/lb"),
                ],
                "Super C": [
                    _make_flipp_item(
                        3,
                        "LONGE DE PORC EXPIRED",
                        "Super C",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2020-01-02T05:00:00+00:00",
                        valid_to="2020-01-09T04:59:59+00:00",
                    ),
                    _make_flipp_item(
                        4,
                        "POITRINE DE POULET FUTURE",
                        "Super C",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2099-01-01T05:00:00+00:00",
                        valid_to="2099-01-08T04:59:59+00:00",
                    ),
                ],
            },
            now=now,
        )
        self.assertEqual(scored["winningStore"], "Maxi")
        self.assertEqual(scored["flyerPeriod"], {"validFrom": "2026-11-12", "validTo": "2026-11-18"})
        self.assertEqual(scored["storeComparison"]["Super C"]["matchedDeals"], 0)
        self.assertEqual(scored["storeComparison"]["Super C"]["weightedScore"], 1.0)
        self.assertEqual(scored["bestDeals"]["pork"]["name"], "LONGE DE PORC")

        # Symmetric: Super C active must beat Maxi 2099 (tie-break defaults to Maxi)
        scored_sym = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(
                        5,
                        "POITRINE DE POULET FUTURE",
                        "Maxi",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2099-01-01T05:00:00+00:00",
                        valid_to="2099-01-08T04:59:59+00:00",
                    ),
                ],
                "Super C": [
                    _make_flipp_item(6, "LONGE DE PORC", "Super C", 3.49, post_price_text="/lb"),
                ],
            },
            now=now,
        )
        self.assertEqual(scored_sym["winningStore"], "Super C")
        self.assertEqual(scored_sym["storeComparison"]["Maxi"]["matchedDeals"], 0)

        # Active store must also beat another store's unreleased near-upcoming flyer
        wed_now = dt.datetime(2026, 11, 18, 13, 0, 0, tzinfo=dt.timezone.utc)
        scored_near = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(7, "LONGE DE PORC", "Maxi", 3.49, post_price_text="/lb"),
                ],
                "Super C": [
                    _make_flipp_item(
                        8,
                        "LONGE DE PORC DEMAIN",
                        "Super C",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2026-11-19T05:00:00+00:00",
                        valid_to="2026-11-26T04:59:59+00:00",
                    ),
                ],
            },
            now=wed_now,
        )
        self.assertEqual(scored_near["winningStore"], "Maxi")
        self.assertEqual(scored_near["storeComparison"]["Super C"]["matchedDeals"], 0)
        self.assertEqual(scored_near["flyerPeriod"], {"validFrom": "2026-11-12", "validTo": "2026-11-18"})

    def test_near_upcoming_thursday_fallback_in_score_stores_rejects_2099(self) -> None:
        now = dt.datetime(2026, 11, 11, 13, 0, 0, tzinfo=dt.timezone.utc)
        scored = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(11, "FILET DE PORC", "Maxi", 4.49, post_price_text="/lb"),
                ],
                "Super C": [
                    _make_flipp_item(12, "FILET DE PORC", "Super C", 2.49, post_price_text="/lb"),
                ],
            },
            now=now,
        )
        self.assertEqual(scored["winningStore"], "Super C")
        self.assertEqual(scored["storeComparison"]["Maxi"]["matchedDeals"], 1)
        self.assertEqual(scored["storeComparison"]["Super C"]["matchedDeals"], 1)
        self.assertEqual(scored["flyerPeriod"], {"validFrom": "2026-11-12", "validTo": "2026-11-18"})

        scored_vs_2099 = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(13, "FILET DE PORC", "Maxi", 3.49, post_price_text="/lb"),
                ],
                "Super C": [
                    _make_flipp_item(
                        14,
                        "FILET DE PORC 2099",
                        "Super C",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2099-01-01T05:00:00+00:00",
                        valid_to="2099-01-08T04:59:59+00:00",
                    ),
                ],
            },
            now=now,
        )
        self.assertEqual(scored_vs_2099["winningStore"], "Maxi")
        self.assertEqual(scored_vs_2099["storeComparison"]["Super C"]["matchedDeals"], 0)

    def test_expired_items_excluded_from_store_scoring(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        scored = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(21, "FILET DE PORC", "Maxi", 3.99, post_price_text="/lb"),
                ],
                "Super C": [
                    _make_flipp_item(
                        22,
                        "FILET DE PORC EXPIRED",
                        "Super C",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2026-11-10T05:00:00+00:00",
                        valid_to="2026-11-17T12:59:59+00:00",
                    ),
                    _make_flipp_item(
                        25,
                        "POITRINE DE POULET INVERTED",
                        "Super C",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2026-11-18T05:00:00+00:00",
                        valid_to="2026-11-12T05:00:00+00:00",
                    ),
                ],
            },
            now=now,
        )
        self.assertEqual(scored["winningStore"], "Maxi")
        self.assertEqual(scored["storeComparison"]["Super C"]["matchedDeals"], 0)

        scored_all_expired = update_plan.score_stores(
            {
                "Maxi": [
                    _make_flipp_item(
                        23,
                        "FILET DE PORC",
                        "Maxi",
                        1.00,
                        post_price_text="/lb",
                        valid_from="2020-01-02T05:00:00+00:00",
                        valid_to="2020-01-09T04:59:59+00:00",
                    ),
                ],
                "Super C": [
                    _make_flipp_item(
                        24,
                        "POITRINE DE POULET",
                        "Super C",
                        1.00,
                        post_price_text="/lb",
                        valid_from="2020-01-02T05:00:00+00:00",
                        valid_to="2020-01-09T04:59:59+00:00",
                    ),
                ],
            },
            now=now,
        )
        self.assertFalse(scored_all_expired["hasLiveDeals"])
        self.assertEqual(scored_all_expired["storeComparison"]["Maxi"]["matchedDeals"], 0)
        self.assertEqual(scored_all_expired["storeComparison"]["Super C"]["matchedDeals"], 0)
        self.assertEqual(scored_all_expired["flyerPeriod"], update_plan.default_flyer_period(now))

    def test_mixed_active_expired_and_upcoming_within_and_across_stores(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        scored = update_plan.score_stores(
            {
                "Super C": [
                    _make_flipp_item(31, "FILET DE PORC ACTIF", "Super C", 3.99, post_price_text="/lb"),
                    _make_flipp_item(
                        32,
                        "FILET DE PORC PROCHAIN",
                        "Super C",
                        1.49,
                        post_price_text="/lb",
                        valid_from="2026-11-19T05:00:00+00:00",
                        valid_to="2026-11-26T04:59:59+00:00",
                    ),
                    _make_flipp_item(
                        33,
                        "POITRINE DE POULET 2099",
                        "Super C",
                        0.01,
                        post_price_text="/lb",
                        valid_from="2099-01-01T05:00:00+00:00",
                        valid_to="2099-01-08T04:59:59+00:00",
                    ),
                    _make_flipp_item(
                        34,
                        "THON EXPIRE 170G",
                        "Super C",
                        0.01,
                        valid_from="2020-01-02T05:00:00+00:00",
                        valid_to="2020-01-09T04:59:59+00:00",
                    ),
                ],
                "Maxi": [
                    _make_flipp_item(35, "FILET DE PORC ACTIF MAXI", "Maxi", 4.49, post_price_text="/lb"),
                    _make_flipp_item(
                        36,
                        "POITRINE DE POULET PROCHAIN MAXI",
                        "Maxi",
                        0.99,
                        post_price_text="/lb",
                        valid_from="2026-11-19T05:00:00+00:00",
                        valid_to="2026-11-26T04:59:59+00:00",
                    ),
                ],
            },
            now=now,
        )
        self.assertEqual(scored["winningStore"], "Super C")
        self.assertEqual(scored["flyerPeriod"], {"validFrom": "2026-11-12", "validTo": "2026-11-18"})
        self.assertEqual(scored["storeComparison"]["Super C"]["matchedDeals"], 1)
        self.assertEqual(scored["storeComparison"]["Maxi"]["matchedDeals"], 1)
        self.assertEqual(scored["bestDeals"]["pork"]["name"], "FILET DE PORC ACTIF")
        self.assertAlmostEqual(scored["bestDeals"]["pork"]["cadPer100g"], round(3.99 / 4.5359237, 4), places=4)
        self.assertNotIn("chicken", scored["bestDeals"])
        self.assertNotIn("canned_fish", scored["bestDeals"])

    def test_walmart_excluded_and_ground_chicken_isolated(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
        # Inject ultra-cheap Walmart item; match_target_store and score_stores must ignore it
        walmart_item = _make_flipp_item(99, "POITRINE DE POULET", "Walmart", 0.50, post_price_text="/lb")
        self.assertIsNone(update_plan.match_target_store(walmart_item))

        items_by_store = {
            "Maxi": [
                walmart_item,
                _make_flipp_item(100, "POITRINE DE POULET", "Maxi", 3.99, post_price_text="/lb"),
            ],
            "Super C": [],
        }
        result = update_plan.score_stores(items_by_store, now=now)
        self.assertIn(result["winningStore"], ("Maxi", "Super C"))
        self.assertEqual(set(result["storeComparison"].keys()), {"Maxi", "Super C"})

        db = update_plan.build_nutrition_db(result["bestDeals"])
        self.assertTrue(db["chicken_breast"]["price"]["onFlyer"])
        self.assertFalse(db["ground_chicken"]["price"]["onFlyer"])
        self.assertEqual(db["ground_chicken"]["price"]["cadPer100g"], 1.10)
        self.assertEqual(db["ground_chicken"]["per100g"], {"calories": 140, "protein": 17.0, "fat": 9.0, "carbs": 0.0})
        self.assertTrue(db["ground_chicken"]["requiresThaw"])

        # Route curly-apostrophe egg whites to eggWhitesDeal, never eggs
        ew_items = {
            "Maxi": [
                _make_flipp_item(200, "BLANCS D\u2019\u0152UFS PC MENU BLEU, 1 KG", "Maxi", 4.99),
                _make_flipp_item(201, "\u0152UFS GROS 12 UN.", "Maxi", 3.49),
            ],
            "Super C": [],
        }
        ew_scored = update_plan.score_stores(ew_items, now=now)
        self.assertEqual(ew_scored["bestDeals"]["eggs"]["name"], "\u0152UFS GROS 12 UN.")
        self.assertIsNotNone(ew_scored["eggWhitesDeal"])
        self.assertIn("BLANCS", ew_scored["eggWhitesDeal"]["name"])

    def test_price_radar_tag_assignment(self) -> None:
        self.assertEqual(update_plan.compute_radar_tag(0.65, 1.43, 0.66, on_flyer=True), (55, "HISTORIC LOW"))
        self.assertEqual(update_plan.compute_radar_tag(0.95, 1.43, 0.66, on_flyer=True), (34, "HOT DEAL"))
        self.assertEqual(update_plan.compute_radar_tag(1.25, 1.43, 0.66, on_flyer=True), (13, "FLYER DEAL"))
        self.assertEqual(update_plan.compute_radar_tag(1.43, 1.43, 0.66, on_flyer=False), (0, "REGULAR"))

    def test_tomato_deal_routing_canned_vs_fresh(self) -> None:
        db_canned = update_plan.build_nutrition_db(
            {"tomatoes": {"name": "coulis de tomates Aurora | Aurora strained tomatoes", "cadPer100g": 0.38}}
        )
        self.assertTrue(db_canned["diced_tomatoes"]["price"]["onFlyer"])
        self.assertFalse(db_canned["pico"]["price"]["onFlyer"])

        db_fresh = update_plan.build_nutrition_db(
            {"tomatoes": {"name": "tomates Roma", "cadPer100g": 0.44}}
        )
        self.assertTrue(db_fresh["pico"]["price"]["onFlyer"])
        self.assertFalse(db_fresh["diced_tomatoes"]["price"]["onFlyer"])


class TestGeminiIntegrationSanitizerAndFallback(unittest.TestCase):
    def test_zero_oil_sanitizer_rules(self) -> None:
        banned = [
            "Drizzle 1 tbsp olive oil",
            "Cook in vegetable oil",
            "Ajouter de l'huile d'olive",
            "Melt 1 tsp butter",
            "Cuire dans le beurre",
            "Use Pam cooking spray",
            "Brush with margarine",
            "Sear in pork lard",
            "Add shortening",
            "Baste with 1 tsp ghee",
            "Roast with beef tallow",
            "No oil needed, then drizzle olive oil",
        ]
        for text in banned:
            with self.subTest(banned=text):
                self.assertTrue(update_plan.contains_added_oil(text))

        allowed = [
            "Boil potatoes until tender",
            "Broil chicken breast for 4 minutes",
            "Line tray with aluminum foil",
            "Trimmed pork tenderloin",
            "Dry-seared in non-stick skillet (0g oil)",
            "Oil-free tomato glaze",
            "Zero added cooking oil, use water or broth",
            "In rich soil",
        ]
        for text in allowed:
            with self.subTest(allowed=text):
                self.assertFalse(update_plan.contains_added_oil(text))

    def test_gemini_structured_json_success_preserves_locked_fields(self) -> None:
        fake_payload = {
            "weeklyTheme": "Montreal Crisp Cabbage & Ginger Pork Week",
            "produceRotationNote": "Spotlight green cabbage slaw and fresh cucumber.",
            "fruitRotationNote": "Enjoy berries at breakfast and banana post-workout.",
            "mealCustomizations": {
                "breakfast": {"seasoningTwist": "Fresh dill, black pepper, and lemon zest"},
                "lunch": {"seasoningTwist": "Smoked paprika, sumac, and broth glaze"},
                "dinner": {"seasoningTwist": "Grated ginger, garlic, and thyme"},
                "snack": {"seasoningTwist": "Cinnamon and vanilla"},
            },
            "prepTips": [
                {"stepId": "step_1", "parallelNote": "Boil rice and braise pork in tomato broth."},
                {"stepId": "step_2", "parallelNote": "Air-fry potatoes with smoked paprika."},
                {"stepId": "step_3", "parallelNote": "Dry-sear chicken with cumin."},
                {"stepId": "step_4", "parallelNote": "Shred cabbage and dice cucumber."},
                {"stepId": "step_5", "parallelNote": "Split Days 1-4 fridge and Day 5+ freezer."},
            ],
        }
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = SimpleNamespace(text=json.dumps(fake_payload))

        with (
            patch.object(update_plan, "genai", SimpleNamespace(Client=MagicMock(return_value=mock_client))),
            patch.object(update_plan, "genai_types", SimpleNamespace(GenerateContentConfig=MagicMock(return_value={}))),
        ):
            plan, ai_source = update_plan.generate_meal_plan(
                winning_store="Maxi",
                deals={"pork": {"name": "FILET DE PORC", "cadPer100g": 0.66}},
                flyer_period={"validFrom": "2026-11-12", "validTo": "2026-11-18"},
                api_key="test-key",
            )
        self.assertEqual(ai_source, "gemini")
        self.assertEqual(plan["mealTemplates"]["weeklyTheme"], "Montreal Crisp Cabbage & Ginger Pork Week")
        self.assertEqual(
            plan["mealTemplates"]["meals"][0]["baseIngredients"],
            ["whole_egg", "egg_whites", "potatoes_raw", "green_onion", "pico", "berries"],
        )
        self.assertEqual(plan["prepTimeline"][0]["timerSeconds"], 2400)

    def test_gemini_allows_cooking_oil_in_seasoning_and_prep_tips(self) -> None:
        oil_payload = {
            "weeklyTheme": "Mediterranean Olive Oil Week",
            "produceRotationNote": "Fresh veggies",
            "fruitRotationNote": "Fresh fruit",
            "mealCustomizations": {
                "breakfast": {"seasoningTwist": "Drizzle 1 tsp olive oil over roasted potatoes"},
                "lunch": {"seasoningTwist": "Sumac and lemon"},
                "dinner": {"seasoningTwist": "Ginger and garlic"},
                "snack": {"seasoningTwist": "Cinnamon"},
            },
            "prepTips": [],
        }
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = SimpleNamespace(text=json.dumps(oil_payload))

        with (
            patch.object(update_plan, "genai", SimpleNamespace(Client=MagicMock(return_value=mock_client))),
            patch.object(update_plan, "genai_types", SimpleNamespace(GenerateContentConfig=MagicMock(return_value={}))),
        ):
            plan, ai_source = update_plan.generate_meal_plan(
                winning_store="Maxi",
                deals={},
                flyer_period={"validFrom": "2026-11-12", "validTo": "2026-11-18"},
                api_key="test-key",
            )
        self.assertEqual(ai_source, "gemini")
        self.assertIn("olive oil", plan["mealTemplates"]["meals"][0]["seasoningTwist"])

    def test_missing_api_key_and_api_error_use_deterministic_fallback(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            plan, ai_source = update_plan.generate_meal_plan(
                winning_store="Super C",
                deals={},
                flyer_period={"validFrom": "2026-11-12", "validTo": "2026-11-18"},
                api_key="",
            )
        self.assertEqual(ai_source, "fallback")
        self.assertEqual(len(plan["mealTemplates"]["meals"]), 4)
        self.assertEqual(len(plan["prepTimeline"]), 5)

        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = RuntimeError("503 Service Unavailable")
        with (
            patch.object(update_plan, "genai", SimpleNamespace(Client=MagicMock(return_value=mock_client))),
            patch.object(update_plan, "genai_types", SimpleNamespace(GenerateContentConfig=MagicMock(return_value={}))),
        ):
            plan2, ai_source2 = update_plan.generate_meal_plan(
                winning_store="Super C",
                deals={},
                flyer_period={"validFrom": "2026-11-12", "validTo": "2026-11-18"},
                api_key="test-key",
            )
        self.assertEqual(ai_source2, "fallback")
        self.assertEqual(plan, plan2)

    def test_all_fallback_profiles_are_valid_strings(self) -> None:
        self.assertGreaterEqual(len(update_plan.FALLBACK_PROFILES), 3)
        self.assertEqual(len(update_plan.BASE_MEAL_TEMPLATES), 4)
        self.assertEqual(len(update_plan.BASE_PREP_TIMELINE), 5)


class TestEndToEndPipelineOutput(unittest.TestCase):
    def _assert_valid_schema(self, data: dict) -> None:
        expected_top = {
            "schemaVersion",
            "generatedAt",
            "source",
            "location",
            "winningStore",
            "flyerPeriod",
            "storeComparison",
            "userProfile",
            "goalPresets",
            "nutritionDb",
            "proteinSwaps",
            "mealTemplates",
            "prepTimeline",
            "weeklyFlyerCatalog",
        }
        self.assertEqual(set(data.keys()), expected_top)
        self.assertEqual(data["schemaVersion"], "1.0.0")
        self.assertIn(data["source"], {"gemini+flipp", "gemini+baseline", "fallback+flipp", "fallback+baseline"})
        self.assertIn(data["winningStore"], {"Maxi", "Super C"})
        self.assertEqual(data["location"]["postalCodeDisplay"], "H1W")
        self.assertEqual(data["location"]["postalCodeQuery"], "H1W1A1")
        self.assertEqual(data["location"]["groceryTaxRate"], 0.0)
        self.assertFalse(data["userProfile"]["zeroAddedOil"])

        self.assertEqual(
            data["goalPresets"],
            {
                "cut": {"id": "cut", "label": "Aggressive Cut", "calories": 1900, "protein": 200, "fat": 50, "carbs": 160},
                "recomp": {"id": "recomp", "label": "Body Recomp", "calories": 2400, "protein": 175, "fat": 80, "carbs": 245},
                "maintenance": {"id": "maintenance", "label": "Maintenance", "calories": 2800, "protein": 190, "fat": 85, "carbs": 315},
            },
        )

        self.assertEqual(set(data["nutritionDb"].keys()), EXPECTED_NUTRITION_KEYS)
        for key, entry in data["nutritionDb"].items():
            self.assertIn(entry["aisle"], update_plan.AISLES, msg=key)
            self.assertIn("price", entry)
            self.assertIn(entry["price"]["radarTag"], {"HISTORIC LOW", "HOT DEAL", "FLYER DEAL", "REGULAR"})

        self.assertEqual(
            data["nutritionDb"]["ground_chicken"]["per100g"],
            {"calories": 140, "protein": 17.0, "fat": 9.0, "carbs": 0.0},
        )
        self.assertEqual(len(data["proteinSwaps"]["lunch"]), 3)
        self.assertEqual(len(data["proteinSwaps"]["dinner"]), 3)
        self.assertEqual([m["id"] for m in data["mealTemplates"]["meals"]], ["breakfast", "lunch", "dinner", "snack"])
        self.assertGreaterEqual(len(data["prepTimeline"]), 5)
        for step in data["prepTimeline"]:
            self.assertEqual(step["timerSeconds"], step["durationMinutes"] * 60)
            self.assertIn("zeroOilNote", step)

    def test_e2e_writes_valid_schema_and_byte_identical_files_flipp_plus_gemini(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)

        def fake_http_get(url: str, params: dict | None = None, timeout: int = 12) -> dict:
            q = (params or {}).get("q", "")
            if q in ("porc", "pork"):
                return {
                    "items": [
                        _make_flipp_item(1, "FILET DE PORC", "Super C", 2.49, post_price_text="/lb"),
                        _make_flipp_item(2, "FILET DE PORC", "Maxi", 4.99, post_price_text="/lb"),
                    ]
                }
            if q in ("chou", "cabbage"):
                return {"items": [_make_flipp_item(3, "CHOU VERT", "Maxi", 0.75, post_price_text="/lb")]}
            if q in ("oeufs", "œufs", "eggs"):
                return {"items": [_make_flipp_item(4, "OEUFS GROS 12 UN.", "Super C", 2.88)]}
            return {"items": []}

        fake_gemini_payload = {
            "weeklyTheme": "Super C Protein Saver Week",
            "produceRotationNote": "Cabbage slaw + cucumber crunch.",
            "fruitRotationNote": "Frozen berries + banana.",
            "mealCustomizations": {
                "breakfast": {"seasoningTwist": "Oregano and cracked pepper"},
                "lunch": {"seasoningTwist": "Sumac, cumin, and lemon"},
                "dinner": {"seasoningTwist": "Ginger, garlic, and thyme"},
                "snack": {"seasoningTwist": "Cinnamon"},
            },
            "prepTips": [
                {"stepId": "step_1", "parallelNote": "Boil rice and braise pork."},
            ],
        }
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = SimpleNamespace(text=json.dumps(fake_gemini_payload))

        with (
            tempfile.TemporaryDirectory() as tmp_dir,
            patch.object(update_plan, "genai", SimpleNamespace(Client=MagicMock(return_value=mock_client))),
            patch.object(update_plan, "genai_types", SimpleNamespace(GenerateContentConfig=MagicMock(return_value={}))),
        ):
            data = update_plan.run_pipeline(
                output_dir=tmp_dir,
                now=now,
                api_key="test-key",
                http_get=fake_http_get,
            )
            self._assert_valid_schema(data)
            self.assertEqual(data["source"], "gemini+flipp")
            self.assertEqual(data["winningStore"], "Super C")
            self.assertEqual(data["flyerPeriod"], {"validFrom": "2026-11-12", "validTo": "2026-11-18"})

            root_bytes = (Path(tmp_dir) / "data.json").read_bytes()
            pub_bytes = (Path(tmp_dir) / "public" / "data.json").read_bytes()
            self.assertEqual(root_bytes, pub_bytes)

    def test_e2e_offline_flipp_fallback_baseline(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)

        def failing_http_get(url: str, params: dict | None = None, timeout: int = 12) -> dict:
            raise RuntimeError("Flipp HTTP 500")

        with tempfile.TemporaryDirectory() as tmp_dir:
            data = update_plan.run_pipeline(
                output_dir=tmp_dir,
                now=now,
                api_key="",
                http_get=failing_http_get,
            )
            self._assert_valid_schema(data)
            self.assertEqual(data["source"], "fallback+baseline")
            self.assertEqual(data["winningStore"], "Maxi")
            self.assertEqual(data["storeComparison"]["Maxi"]["matchedDeals"], 0)
            self.assertEqual(data["storeComparison"]["Maxi"]["weightedScore"], 1.0)
            self.assertEqual(
                (Path(tmp_dir) / "data.json").read_bytes(),
                (Path(tmp_dir) / "public" / "data.json").read_bytes(),
            )

    def test_fallback_pipeline_handles_oil_deals_cleanly(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)

        plan = update_plan.build_fallback_plan(
            "Maxi",
            deals={
                "canned_fish": {"name": "THON PALE DANS L'HUILE 170G"},
                "potatoes": {"name": "POMMES DE TERRE AU BEURRE"},
                "pork": {"name": "FILET DE PORC FRAIS"},
            },
            flyer_period={"validFrom": "2026-11-12", "validTo": "2026-11-18"},
        )
        self.assertIn("FILET DE PORC FRAIS", plan["mealTemplates"]["weeklyTheme"])
        self.assertIn("THON PALE", plan["mealTemplates"]["weeklyTheme"])

        def oil_flyer_http_get(url: str, params: dict | None = None, timeout: int = 12) -> dict:
            q = (params or {}).get("q", "")
            if q in ("thon", "tuna", "sardines"):
                return {
                    "items": [
                        _make_flipp_item(301, "THON PALE DANS L'HUILE 170G", "Maxi", 1.25),
                        _make_flipp_item(302, "THON PALE DANS L'EAU 170G", "Maxi", 1.49),
                    ]
                }
            if q in ("pommes de terre", "potatoes"):
                return {
                    "items": [
                        _make_flipp_item(303, "POMMES DE TERRE BLANCHES 500G", "Maxi", 1.99),
                    ]
                }
            return {"items": []}

        with tempfile.TemporaryDirectory() as tmp_dir:
            data = update_plan.run_pipeline(
                output_dir=tmp_dir,
                now=now,
                api_key="",
                http_get=oil_flyer_http_get,
            )
            self._assert_valid_schema(data)
            self.assertEqual(data["source"], "fallback+flipp")
            self.assertEqual(data["nutritionDb"]["potatoes_raw"]["price"]["flyerItemName"], "POMMES DE TERRE BLANCHES 500G")
            self.assertEqual(
                (Path(tmp_dir) / "data.json").read_bytes(),
                (Path(tmp_dir) / "public" / "data.json").read_bytes(),
            )

    def test_e2e_regression_t2_f02_03_active_store_beats_expired_and_2099_future(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)

        def flipp_with_expired_and_2099(url: str, params: dict | None = None, timeout: int = 12) -> dict:
            q = (params or {}).get("q", "")
            if q in ("porc", "pork"):
                return {
                    "items": [
                        _make_flipp_item(401, "LONGE DE PORC", "Maxi", 3.49, post_price_text="/lb"),
                        _make_flipp_item(
                            402,
                            "LONGE DE PORC EXPIRED",
                            "Super C",
                            0.01,
                            post_price_text="/lb",
                            valid_from="2020-01-02T05:00:00+00:00",
                            valid_to="2020-01-09T04:59:59+00:00",
                        ),
                    ]
                }
            if q in ("poulet", "chicken"):
                return {
                    "items": [
                        _make_flipp_item(403, "POITRINE DE POULET", "Maxi", 4.99, post_price_text="/lb"),
                        _make_flipp_item(
                            404,
                            "POITRINE DE POULET FUTURE",
                            "Super C",
                            0.01,
                            post_price_text="/lb",
                            valid_from="2099-01-01T05:00:00+00:00",
                            valid_to="2099-01-08T04:59:59+00:00",
                        ),
                    ]
                }
            return {"items": []}

        with tempfile.TemporaryDirectory() as tmp_dir:
            data = update_plan.run_pipeline(
                output_dir=tmp_dir,
                now=now,
                api_key="",
                http_get=flipp_with_expired_and_2099,
            )
            self._assert_valid_schema(data)
            self.assertEqual(data["source"], "fallback+flipp")
            self.assertEqual(data["winningStore"], "Maxi")
            self.assertEqual(data["flyerPeriod"], {"validFrom": "2026-11-12", "validTo": "2026-11-18"})
            self.assertEqual(data["storeComparison"]["Super C"]["matchedDeals"], 0)
            self.assertEqual(data["nutritionDb"]["pork_loin_lean"]["price"]["flyerItemName"], "LONGE DE PORC")
            self.assertEqual(data["nutritionDb"]["chicken_breast"]["price"]["flyerItemName"], "POITRINE DE POULET")
            self.assertEqual(
                (Path(tmp_dir) / "data.json").read_bytes(),
                (Path(tmp_dir) / "public" / "data.json").read_bytes(),
            )

    def test_weekly_flyer_catalog_maxi_superc_only_and_allows_cooking_oils(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)

        def catalog_http_get(url: str, params: dict | None = None, timeout: int = 12) -> dict:
            q = (params or {}).get("q", "")
            if q == "boeuf":
                return {
                    "items": [
                        _make_flipp_item(901, "BOEUF HACHE EXTRA MAIGRE", "Maxi", 5.99, post_price_text="/lb"),
                        _make_flipp_item(902, "BOEUF WALMART STEAK", "Walmart", 3.99, post_price_text="/lb"),
                        _make_flipp_item(903, "SAUCISSES DE BOEUF", "Maxi", 4.49),
                    ]
                }
            if q == "brocoli":
                return {
                    "items": [
                        _make_flipp_item(904, "COURONNES DE BROCOLI", "Super C", 1.49),
                        _make_flipp_item(905, "HUILE D'OLIVE EXTRA VIERGE", "Super C", 6.99),
                    ]
                }
            if q in ("porc", "pork"):
                return {
                    "items": [
                        _make_flipp_item(906, "LONGE DE PORC", "Super C", 2.99, post_price_text="/lb"),
                    ]
                }
            return {"items": []}

        with tempfile.TemporaryDirectory() as tmp_dir:
            data = update_plan.run_pipeline(
                output_dir=tmp_dir,
                now=now,
                api_key="",
                http_get=catalog_http_get,
            )
            self._assert_valid_schema(data)
            self.assertEqual(set(data["nutritionDb"].keys()), EXPECTED_NUTRITION_KEYS)
            self.assertIn("weeklyFlyerCatalog", data)
            catalog = data["weeklyFlyerCatalog"]
            self.assertEqual(set(catalog.keys()), {"Maxi", "Super C"})

            maxi_names = [it["name"] for it in catalog["Maxi"]]
            sc_names = [it["name"] for it in catalog["Super C"]]
            self.assertIn("BOEUF HACHE EXTRA MAIGRE", maxi_names)
            self.assertNotIn("SAUCISSES DE BOEUF", maxi_names)
            self.assertIn("COURONNES DE BROCOLI", sc_names)
            self.assertIn("LONGE DE PORC", sc_names)
            self.assertIn("HUILE D'OLIVE EXTRA VIERGE", sc_names)

            catalog_str = json.dumps(catalog).lower()
            self.assertNotIn("walmart", catalog_str)


class TestSharedSchemaParity(unittest.TestCase):
    SCHEMA_PATH = ROOT_DIR / "schema" / "nutrition_baseline.json"
    SCRIPT_PATH = ROOT_DIR / "scripts" / "update_plan.py"

    def test_schema_structure_constraints_and_r4_exclusion(self) -> None:
        raw_text = self.SCHEMA_PATH.read_text(encoding="utf-8")
        schema = json.loads(raw_text)

        self.assertEqual(schema["schemaVersion"], "1.0.0")
        self.assertEqual(schema["aisleOrder"], ["Produce", "Meat", "Dairy/Eggs", "Pantry/Canned", "Frozen"])
        self.assertEqual(set(schema["goalPresets"].keys()), {"cut", "recomp", "maintenance"})

        expected_subcats = {
            "pork", "chicken", "canned_fish", "eggs", "potatoes",
            "rice", "cabbage", "cucumbers", "tomatoes", "carrots", "white_beans",
        }
        cat_baselines = schema["categoryBaselines"]
        for key in ("baselinePrices", "historicalLows", "defaultUnitWeights"):
            self.assertEqual(set(cat_baselines[key].keys()), expected_subcats, msg=key)

        db = schema["nutritionDb"]
        self.assertEqual(set(db.keys()), EXPECTED_NUTRITION_KEYS)
        for key, entry in db.items():
            self.assertIn(entry["aisle"], schema["aisleOrder"], msg=key)
            self.assertGreater(entry["cookedYield"], 0, msg=key)
            self.assertGreater(entry["packageGrams"], 0, msg=key)

        self.assertEqual(db["tuna_water"]["cookedYield"], 1.0)
        self.assertEqual(db["aromatics_zero"]["unitLabel"], "pantry")
        self.assertEqual(db["aromatics_zero"]["price"]["cadPer100g"], 0.0)
        self.assertEqual(db["aromatics_zero"]["price"]["cadPerPackage"], 0.0)
        for bulk_id in ("banana", "pork_loin_lean", "pork_shoulder", "chicken_breast", "cabbage"):
            self.assertEqual(db[bulk_id]["unitLabel"], "kg", msg=bulk_id)

        self.assertEqual(db["ground_chicken"]["packageGrams"], 454)
        self.assertEqual(db["ground_chicken"]["per100g"], {"calories": 140, "protein": 17.0, "fat": 9.0, "carbs": 0.0})
        self.assertEqual(db["ground_chicken"]["price"]["cadPer100g"], 1.10)
        self.assertEqual(db["ground_chicken"]["price"]["cadPerPackage"], 5.00)
        self.assertEqual(db["cabbage"]["price"]["regularCadPer100g"], 0.28)
        self.assertEqual(db["cucumber"]["price"]["cadPerPackage"], 2.00)

        lower_text = raw_text.lower()
        for forbidden in ("leftover", "rollover", "roll_over", "partial_package", "partialpackage"):
            self.assertNotIn(forbidden, lower_text)

    def test_update_plan_hydrates_from_schema_without_hardcoded_duplication(self) -> None:
        schema = json.loads(self.SCHEMA_PATH.read_text(encoding="utf-8"))
        script_src = self.SCRIPT_PATH.read_text(encoding="utf-8")

        self.assertNotIn('"whole_egg": {', script_src)
        self.assertNotIn('"ground_chicken": {', script_src)
        self.assertNotIn('"Aggressive Cut"', script_src)
        self.assertNotIn('"pork": 1.21', script_src)

        self.assertEqual(list(update_plan.AISLES), schema["aisleOrder"])
        self.assertEqual(update_plan.GOAL_PRESETS, schema["goalPresets"])
        self.assertEqual(update_plan.BASELINE_PRICES, schema["categoryBaselines"]["baselinePrices"])
        self.assertEqual(update_plan.HISTORICAL_LOWS, schema["categoryBaselines"]["historicalLows"])
        self.assertEqual(update_plan.DEFAULT_UNIT_WEIGHTS, schema["categoryBaselines"]["defaultUnitWeights"])
        self.assertEqual(update_plan.DEFAULT_NUTRITION_DB, schema["nutritionDb"])

    def test_run_pipeline_custom_schema_isolation_and_error_paths(self) -> None:
        with self.assertRaises(FileNotFoundError):
            update_plan.load_nutrition_baseline(ROOT_DIR / "schema" / "does_not_exist.json")

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            bad_schema = tmp_path / "bad_schema.json"
            bad_schema.write_text('{"schemaVersion": "1.0.0"}', encoding="utf-8")
            with self.assertRaises(ValueError):
                update_plan.load_nutrition_baseline(bad_schema)

            custom_schema_data = json.loads(self.SCHEMA_PATH.read_text(encoding="utf-8"))
            custom_schema_data["goalPresets"]["cut"]["calories"] = 1850
            custom_schema_data["nutritionDb"]["cabbage"]["price"]["regularCadPer100g"] = 0.35
            custom_schema_path = tmp_path / "custom_schema.json"
            custom_schema_path.write_text(json.dumps(custom_schema_data), encoding="utf-8")

            orig_cut_cal = update_plan.GOAL_PRESETS["cut"]["calories"]
            orig_cabbage_reg = update_plan.DEFAULT_NUTRITION_DB["cabbage"]["price"]["regularCadPer100g"]

            out_dir = tmp_path / "out"
            now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)
            data = update_plan.run_pipeline(
                output_dir=out_dir,
                now=now,
                api_key="",
                http_get=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("offline")),
                schema_path=custom_schema_path,
            )

            self.assertEqual(data["goalPresets"]["cut"]["calories"], 1850)
            self.assertEqual(data["nutritionDb"]["cabbage"]["price"]["regularCadPer100g"], 0.35)
            # Module globals remain untouched
            self.assertEqual(update_plan.GOAL_PRESETS["cut"]["calories"], orig_cut_cal)
            self.assertEqual(update_plan.DEFAULT_NUTRITION_DB["cabbage"]["price"]["regularCadPer100g"], orig_cabbage_reg)

    def test_main_zero_arg_and_schema_file_cli(self) -> None:
        fake_data = {
            "source": "fallback+baseline",
            "winningStore": "Maxi",
            "flyerPeriod": {"validFrom": "2026-11-12", "validTo": "2026-11-18"},
        }
        with patch.object(update_plan, "run_pipeline", return_value=copy.deepcopy(fake_data)) as mock_run:
            rc_zero = update_plan.main()
            self.assertEqual(rc_zero, 0)
            mock_run.assert_called_once_with(schema_path=None)

        with patch.object(update_plan, "run_pipeline", return_value=copy.deepcopy(fake_data)) as mock_run_cli:
            rc_cli = update_plan.main(["--schema-file", "custom/path.json"])
            self.assertEqual(rc_cli, 0)
            mock_run_cli.assert_called_once_with(schema_path="custom/path.json")

    def test_python_and_node_macro_engine_export_parity(self) -> None:
        node_bin = shutil.which("node")
        if not node_bin:
            self.skipTest("node executable not available")

        proc = subprocess.run(
            [
                node_bin,
                "-e",
                (
                    "const me = require('./js/macroEngine.js');"
                    "console.log(JSON.stringify({"
                    "aisleOrder: me.AISLE_ORDER,"
                    "goalPresets: me.GOAL_PRESETS,"
                    "nutritionDb: me.DEFAULT_NUTRITION_DB"
                    "}));"
                ),
            ],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            check=True,
        )
        js_exports = json.loads(proc.stdout)
        self.assertEqual(list(update_plan.AISLES), js_exports["aisleOrder"])
        self.assertEqual(update_plan.GOAL_PRESETS, js_exports["goalPresets"])
        self.assertEqual(update_plan.DEFAULT_NUTRITION_DB, js_exports["nutritionDb"])

    def test_load_nutrition_baseline_rejects_semantic_violations_and_allows_oils(self) -> None:
        base_schema = json.loads(self.SCHEMA_PATH.read_text(encoding="utf-8"))

        def _expect_value_error(mutator, label: str) -> None:
            candidate = copy.deepcopy(base_schema)
            mutator(candidate)
            with tempfile.TemporaryDirectory() as tmp_dir:
                bad_path = Path(tmp_dir) / "bad_semantic.json"
                bad_path.write_text(json.dumps(candidate), encoding="utf-8")
                with self.assertRaises(ValueError, msg=label):
                    update_plan.load_nutrition_baseline(bad_path)

        # Oil entry in nutritionDb is permitted cleanly
        oil_candidate = copy.deepcopy(base_schema)
        oil_candidate["nutritionDb"]["olive_oil"] = {
            "name": "Extra Virgin Olive Oil",
            "aisle": "Pantry/Canned",
            "per100g": {"calories": 884, "protein": 0, "fat": 100, "carbs": 0},
            "cookedYield": 1.0,
            "packageGrams": 500,
            "unitLabel": "bottle",
            "price": {"cadPer100g": 1.5, "cadPerPackage": 7.5, "regularCadPer100g": 1.5, "historicalLowCadPer100g": 1.0},
        }
        with tempfile.TemporaryDirectory() as tmp_dir:
            ok_path = Path(tmp_dir) / "oil_allowed.json"
            ok_path.write_text(json.dumps(oil_candidate), encoding="utf-8")
            loaded = update_plan.load_nutrition_baseline(ok_path)
            self.assertIn("olive_oil", loaded["nutritionDb"])
        _expect_value_error(lambda s: s["categoryBaselines"]["baselinePrices"].__setitem__("pork", 0), "zero_baseline_price")
        _expect_value_error(lambda s: s["categoryBaselines"]["baselinePrices"].pop("chicken"), "missing_baseline_subcat")
        _expect_value_error(lambda s: s["goalPresets"]["cut"].__setitem__("calories", -500), "negative_goal_preset_calories")
        _expect_value_error(lambda s: s["goalPresets"].__setitem__("cut", "broken"), "non_dict_goal_preset")
        _expect_value_error(
            lambda s: s["nutritionDb"]["whole_egg"]["per100g"].__setitem__("protein", "bad"),
            "non_numeric_per100g",
        )
        _expect_value_error(
            lambda s: s["nutritionDb"]["whole_egg"]["per100g"].__setitem__("calories", -10),
            "negative_per100g",
        )
        _expect_value_error(
            lambda s: s["nutritionDb"]["whole_egg"].__setitem__("cookedYield", 0),
            "zero_cooked_yield",
        )
        _expect_value_error(
            lambda s: s["nutritionDb"]["whole_egg"].__setitem__("aisle", "NonexistentAisle"),
            "invalid_aisle",
        )
        _expect_value_error(
            lambda s: s["aisleOrder"].append("Produce"),
            "duplicate_aisle",
        )


class TestPriceHistoryTrackingAndRadar(unittest.TestCase):
    @staticmethod
    def _build_http_get(items_by_query: dict[str, list[dict[str, object]]]):
        def _fake_http_get(url: str, params: dict | None = None, timeout: int = 12) -> dict:
            q = (params or {}).get("q", "")
            return {"items": copy.deepcopy(items_by_query.get(q, []))}

        return _fake_http_get

    @staticmethod
    def _seed_obs(days_ago: int, now: dt.datetime, store: str, price: float, item_name: str, subcat: str) -> dict:
        obs_date = (now.date() - dt.timedelta(days=days_ago)).isoformat()
        return {
            "observedAt": obs_date,
            "store": store,
            "cadPer100g": price,
            "itemName": item_name,
            "subcategory": subcat,
        }

    def test_rolling_52_week_364_day_pruning_boundary_and_empty_cleanup(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            seeded = {
                "schemaVersion": "1.0.0",
                "windowWeeks": 52,
                "updatedAt": "2026-11-05T13:00:00Z",
                "byPostalCode": {
                    "H1W": {
                        "pork_loin_lean": [
                            self._seed_obs(365, now, "Maxi", 0.50, "OLD PORK", "pork"),
                            self._seed_obs(364, now, "Maxi", 0.90, "BOUNDARY PORK", "pork"),
                        ],
                        "cabbage": [
                            self._seed_obs(365, now, "Maxi", 0.15, "OLD CABBAGE", "cabbage"),
                        ],
                    },
                    "M5V": {
                        "cabbage": [
                            self._seed_obs(400, now, "Super C", 0.19, "STALE M5V CABBAGE", "cabbage"),
                        ],
                    },
                },
            }
            hist_path.write_text(json.dumps(seeded), encoding="utf-8")

            http_get = self._build_http_get({
                "porc": [
                    _make_flipp_item(101, "LONGE DE PORC DESOSSEE", "Maxi", 4.49, post_price_text="/lb"),
                ],
            })
            update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )

            hist = json.loads(hist_path.read_text(encoding="utf-8"))
            self.assertEqual(hist["schemaVersion"], "1.0.0")
            self.assertEqual(hist["windowWeeks"], 52)
            self.assertEqual(hist["updatedAt"], "2026-11-12T13:00:00Z")
            self.assertIn("H1W", hist["byPostalCode"])
            self.assertNotIn("M5V", hist["byPostalCode"])
            self.assertNotIn("cabbage", hist["byPostalCode"]["H1W"])

            pork_dates = {o["observedAt"] for o in hist["byPostalCode"]["H1W"]["pork_loin_lean"]}
            self.assertNotIn((now.date() - dt.timedelta(days=365)).isoformat(), pork_dates)
            self.assertIn((now.date() - dt.timedelta(days=364)).isoformat(), pork_dates)
            self.assertIn(now.date().isoformat(), pork_dates)

    def test_postal_fsa_keying_and_cross_postal_isolation(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            seeded = {
                "schemaVersion": "1.0.0",
                "windowWeeks": 52,
                "updatedAt": "2026-11-05T13:00:00Z",
                "byPostalCode": {
                    "M5V": {
                        "pork_loin_lean": [
                            self._seed_obs(28, now, "Maxi", 0.40, "LONGE", "pork"),
                            self._seed_obs(21, now, "Maxi", 0.42, "LONGE", "pork"),
                            self._seed_obs(14, now, "Maxi", 0.44, "LONGE", "pork"),
                            self._seed_obs(7, now, "Maxi", 0.45, "LONGE", "pork"),
                        ],
                    },
                    "H1W": {
                        "pork_loin_lean": [
                            self._seed_obs(28, now, "Maxi", 1.20, "LONGE", "pork"),
                            self._seed_obs(21, now, "Maxi", 1.22, "LONGE", "pork"),
                            self._seed_obs(14, now, "Maxi", 1.25, "LONGE", "pork"),
                            self._seed_obs(7, now, "Maxi", 1.30, "LONGE", "pork"),
                        ],
                    },
                },
            }
            hist_path.write_text(json.dumps(seeded), encoding="utf-8")

            http_get = self._build_http_get({
                "porc": [
                    _make_flipp_item(102, "LONGE DE PORC DESOSSEE", "Maxi", 8.00, post_price_text="/kg"),
                ],
            })
            data_m5v = update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="m5v 3l9",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )
            data_h1w = update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="h1w 2x3",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )

            hist = json.loads(hist_path.read_text(encoding="utf-8"))
            self.assertEqual(set(hist["byPostalCode"].keys()), {"M5V", "H1W"})
            self.assertNotEqual(data_m5v["nutritionDb"]["pork_loin_lean"]["price"]["radarTag"], "HISTORIC LOW")
            self.assertEqual(data_h1w["nutritionDb"]["pork_loin_lean"]["price"]["radarTag"], "HISTORIC LOW")

    def test_idempotent_upsert_deduplication_and_store_distinction(self) -> None:
        day1_t1 = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        day1_t2 = dt.datetime(2026, 11, 12, 16, 0, 0, tzinfo=dt.timezone.utc)
        day8 = dt.datetime(2026, 11, 19, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"

            http_first = self._build_http_get({
                "porc": [
                    _make_flipp_item(103, "LONGE DE PORC", "Maxi", 4.99, post_price_text="/lb"),
                    _make_flipp_item(104, "LONGE DE PORC", "Super C", 3.99, post_price_text="/lb"),
                ],
            })
            update_plan.run_pipeline(
                output_dir=tmp_path,
                now=day1_t1,
                postal_code="H1W",
                api_key="",
                http_get=http_first,
                history_path=hist_path,
            )

            http_second = self._build_http_get({
                "porc": [
                    _make_flipp_item(105, "LONGE DE PORC", "Maxi", 3.49, post_price_text="/lb"),
                    _make_flipp_item(106, "LONGE DE PORC", "Super C", 3.99, post_price_text="/lb"),
                ],
            })
            update_plan.run_pipeline(
                output_dir=tmp_path,
                now=day1_t2,
                postal_code="H1W",
                api_key="",
                http_get=http_second,
                history_path=hist_path,
            )

            hist = json.loads(hist_path.read_text(encoding="utf-8"))
            obs_day1 = hist["byPostalCode"]["H1W"]["pork_loin_lean"]
            maxi_day1 = [o for o in obs_day1 if o["observedAt"] == "2026-11-12" and o["store"] == "Maxi"]
            superc_day1 = [o for o in obs_day1 if o["observedAt"] == "2026-11-12" and o["store"] == "Super C"]
            self.assertEqual(len(maxi_day1), 1)
            self.assertAlmostEqual(maxi_day1[0]["cadPer100g"], round(3.49 / 4.5359237, 4), places=3)
            self.assertEqual(len(superc_day1), 1)

            http_day8 = self._build_http_get({
                "porc": [
                    _make_flipp_item(
                        107,
                        "LONGE DE PORC",
                        "Maxi",
                        3.79,
                        post_price_text="/lb",
                        valid_from="2026-11-19T05:00:00+00:00",
                        valid_to="2026-11-26T04:59:59+00:00",
                    ),
                ],
            })
            update_plan.run_pipeline(
                output_dir=tmp_path,
                now=day8,
                postal_code="H1W",
                api_key="",
                http_get=http_day8,
                history_path=hist_path,
            )
            hist_after = json.loads(hist_path.read_text(encoding="utf-8"))
            maxi_all = [o for o in hist_after["byPostalCode"]["H1W"]["pork_loin_lean"] if o["store"] == "Maxi"]
            self.assertEqual(len(maxi_all), 2)

    def test_cold_start_and_sparse_history_fallback_to_schema_baselines(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        schema_data = json.loads((ROOT_DIR / "schema" / "nutrition_baseline.json").read_text(encoding="utf-8"))
        schema_data["nutritionDb"]["chicken_breast"]["price"]["regularCadPer100g"] = 1.55
        schema_data["nutritionDb"]["chicken_breast"]["price"]["historicalLowCadPer100g"] = 0.95

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            custom_schema = tmp_path / "custom_schema.json"
            custom_schema.write_text(json.dumps(schema_data), encoding="utf-8")

            http_get = self._build_http_get({
                "poulet": [
                    _make_flipp_item(108, "POITRINE DE POULET DESOSSEE", "Maxi", 11.00, post_price_text="/kg"),
                ],
            })

            # Cold start (0 prior observations)
            cold_hist = tmp_path / "cold_history.json"
            cold_data = update_plan.run_pipeline(
                output_dir=tmp_path / "cold_out",
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                schema_path=custom_schema,
                history_path=cold_hist,
            )
            self.assertEqual(cold_data["nutritionDb"]["chicken_breast"]["price"]["regularCadPer100g"], 1.55)
            self.assertEqual(cold_data["nutritionDb"]["chicken_breast"]["price"]["historicalLowCadPer100g"], 0.95)

            # Sparse history (2 prior + 1 current = 3 < MIN_HISTORY_OBS=4)
            sparse_hist = tmp_path / "sparse_history.json"
            sparse_hist.write_text(
                json.dumps({
                    "schemaVersion": "1.0.0",
                    "windowWeeks": 52,
                    "updatedAt": "2026-11-05T13:00:00Z",
                    "byPostalCode": {
                        "H1W": {
                            "chicken_breast": [
                                self._seed_obs(14, now, "Maxi", 0.55, "POITRINE", "chicken"),
                                self._seed_obs(7, now, "Maxi", 0.55, "POITRINE", "chicken"),
                            ],
                        },
                    },
                }),
                encoding="utf-8",
            )
            sparse_data = update_plan.run_pipeline(
                output_dir=tmp_path / "sparse_out",
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                schema_path=custom_schema,
                history_path=sparse_hist,
            )
            self.assertEqual(sparse_data["nutritionDb"]["chicken_breast"]["price"]["regularCadPer100g"], 1.55)
            self.assertEqual(sparse_data["nutritionDb"]["chicken_breast"]["price"]["historicalLowCadPer100g"], 0.95)
            self.assertGreater(sparse_data["nutritionDb"]["chicken_breast"]["price"]["savingsPct"], 0)

    def test_self_calibrating_historic_low_and_hot_deal_with_sale_bias_protection(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            seeded = {
                "schemaVersion": "1.0.0",
                "windowWeeks": 52,
                "updatedAt": "2026-11-05T13:00:00Z",
                "byPostalCode": {
                    "H1W": {
                        "pork_loin_lean": [
                            self._seed_obs(35, now, "Maxi", 1.15, "LONGE", "pork"),
                            self._seed_obs(28, now, "Maxi", 1.20, "LONGE", "pork"),
                            self._seed_obs(21, now, "Maxi", 1.25, "LONGE", "pork"),
                            self._seed_obs(14, now, "Maxi", 1.30, "LONGE", "pork"),
                            self._seed_obs(7, now, "Maxi", 1.35, "LONGE", "pork"),
                        ],
                        "chicken_breast": [
                            self._seed_obs(42, now, "Super C", 1.00, "POITRINE", "chicken"),
                            self._seed_obs(35, now, "Maxi", 1.98, "POITRINE", "chicken"),
                            self._seed_obs(28, now, "Maxi", 2.00, "POITRINE", "chicken"),
                            self._seed_obs(21, now, "Super C", 2.02, "POITRINE", "chicken"),
                            self._seed_obs(14, now, "Maxi", 2.05, "POITRINE", "chicken"),
                            self._seed_obs(7, now, "Maxi", 2.10, "POITRINE", "chicken"),
                        ],
                        "tuna_water": [
                            self._seed_obs(42, now, "Maxi", 0.90, "THON", "canned_fish"),
                            self._seed_obs(35, now, "Maxi", 0.95, "THON", "canned_fish"),
                            self._seed_obs(28, now, "Maxi", 0.99, "THON", "canned_fish"),
                            self._seed_obs(21, now, "Super C", 1.80, "THON", "canned_fish"),
                            self._seed_obs(14, now, "Super C", 1.85, "THON", "canned_fish"),
                            self._seed_obs(7, now, "Super C", 1.90, "THON", "canned_fish"),
                        ],
                    },
                },
            }
            hist_path.write_text(json.dumps(seeded), encoding="utf-8")

            http_get = self._build_http_get({
                "porc": [
                    _make_flipp_item(109, "LONGE DE PORC DESOSSEE", "Maxi", 8.00, post_price_text="/kg"),
                ],
                "poulet": [
                    _make_flipp_item(110, "POITRINE DE POULET DESOSSEE", "Maxi", 14.00, post_price_text="/kg"),
                ],
            })
            data = update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )

            pork_price = data["nutritionDb"]["pork_loin_lean"]["price"]
            self.assertEqual(pork_price["radarTag"], "HISTORIC LOW")
            self.assertAlmostEqual(pork_price["historicalLowCadPer100g"], 0.80, delta=0.02)

            chx_price = data["nutritionDb"]["chicken_breast"]["price"]
            self.assertEqual(chx_price["radarTag"], "HOT DEAL")
            self.assertGreaterEqual(chx_price["savingsPct"], 25)

            tuna_price = data["nutritionDb"]["tuna_water"]["price"]
            self.assertGreaterEqual(tuna_price["regularCadPer100g"], 1.75)

    def test_corrupted_and_malformed_price_history_recovery(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        valid_entry = self._seed_obs(7, now, "Maxi", 0.99, "LONGE VALIDE", "pork")
        cases = [
            ("invalid_json", "{corrupt-json-not-valid!!!"),
            ("list_root", "[]"),
            ("non_dict_by_postal", json.dumps({"schemaVersion": "1.0.0", "windowWeeks": 52, "byPostalCode": "bad"})),
            (
                "malformed_entries",
                json.dumps({
                    "schemaVersion": "1.0.0",
                    "windowWeeks": 52,
                    "byPostalCode": {
                        "INVALID": {"cabbage": [valid_entry]},
                        "H1W": {
                            "pork_loin_lean": [
                                "not-a-dict",
                                {"store": "Maxi", "cadPer100g": 0.9, "itemName": "x", "subcategory": "pork"},
                                {"observedAt": "not-a-date", "store": "Maxi", "cadPer100g": 0.9, "itemName": "x", "subcategory": "pork"},
                                {"observedAt": "2026-11-05", "store": "Maxi", "cadPer100g": True, "itemName": "x", "subcategory": "pork"},
                                {"observedAt": "2026-11-05", "store": "Maxi", "cadPer100g": -1.5, "itemName": "x", "subcategory": "pork"},
                                valid_entry,
                            ],
                        },
                    },
                }),
            ),
        ]

        http_get = self._build_http_get({
            "chou": [_make_flipp_item(111, "CHOU VERT", "Maxi", 0.99, post_price_text="/lb")],
        })
        for label, payload in cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)
                hist_path = tmp_path / "price_history.json"
                hist_path.write_text(payload, encoding="utf-8")

                data = update_plan.run_pipeline(
                    output_dir=tmp_path,
                    now=now,
                    postal_code="H1W",
                    api_key="",
                    http_get=http_get,
                    history_path=hist_path,
                )
                self.assertEqual(data["source"], "fallback+flipp")
                recovered = json.loads(hist_path.read_text(encoding="utf-8"))
                self.assertEqual(recovered["schemaVersion"], "1.0.0")
                self.assertEqual(recovered["windowWeeks"], 52)
                self.assertIn("H1W", recovered["byPostalCode"])
                self.assertNotIn("INVALID", recovered["byPostalCode"])
                if label == "malformed_entries":
                    pork_entries = recovered["byPostalCode"]["H1W"]["pork_loin_lean"]
                    self.assertEqual(len(pork_entries), 1)
                    self.assertEqual(pork_entries[0]["itemName"], "LONGE VALIDE")

    def test_offline_flipp_failure_preserves_existing_price_history(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            recent_obs = self._seed_obs(7, now, "Maxi", 0.77, "LONGE DE PORC", "pork")
            stale_obs = self._seed_obs(400, now, "Maxi", 0.50, "OLD PORC", "pork")
            hist_path.write_text(
                json.dumps({
                    "schemaVersion": "1.0.0",
                    "windowWeeks": 52,
                    "updatedAt": "2026-11-05T13:00:00Z",
                    "byPostalCode": {"H1W": {"pork_loin_lean": [stale_obs, recent_obs]}},
                }),
                encoding="utf-8",
            )

            def failing_http_get(*args, **kwargs):
                raise RuntimeError("Flipp HTTP 500")

            data = update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=failing_http_get,
                history_path=hist_path,
            )
            self.assertEqual(data["source"], "fallback+baseline")
            hist = json.loads(hist_path.read_text(encoding="utf-8"))
            pork_obs = hist["byPostalCode"]["H1W"]["pork_loin_lean"]
            self.assertEqual(len(pork_obs), 1)
            self.assertEqual(pork_obs[0]["observedAt"], recent_obs["observedAt"])
            self.assertEqual(pork_obs[0]["cadPer100g"], 0.77)

    def test_history_file_cli_and_history_path_isolation(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            out_dir = tmp_path / "out"
            custom_hist = tmp_path / "nested" / "custom_history.json"
            http_get = self._build_http_get({
                "chou": [_make_flipp_item(112, "CHOU VERT", "Maxi", 0.99, post_price_text="/lb")],
            })
            update_plan.run_pipeline(
                output_dir=out_dir,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                history_path=custom_hist,
            )
            self.assertTrue(custom_hist.exists())
            self.assertFalse((out_dir / "price_history.json").exists())

        fake_data = {
            "source": "fallback+baseline",
            "winningStore": "Maxi",
            "flyerPeriod": {"validFrom": "2026-11-12", "validTo": "2026-11-18"},
        }
        with patch.object(update_plan, "run_pipeline", return_value=copy.deepcopy(fake_data)) as mock_hist:
            rc = update_plan.main(["--history-file", "custom/hist.json"])
            self.assertEqual(rc, 0)
            mock_hist.assert_called_once_with(schema_path=None, history_path="custom/hist.json")

        with patch.object(update_plan, "run_pipeline", return_value=copy.deepcopy(fake_data)) as mock_both:
            rc_both = update_plan.main(["--schema-file", "s.json", "--history-file", "h.json"])
            self.assertEqual(rc_both, 0)
            mock_both.assert_called_once_with(schema_path="s.json", history_path="h.json")

    def test_ground_chicken_isolation_and_deal_routing_in_price_history(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            http_get = self._build_http_get({
                "poulet": [
                    _make_flipp_item(113, "POITRINE DE POULET", "Walmart", 0.50, post_price_text="/lb"),
                    _make_flipp_item(114, "CUISSES DE POULET", "Maxi", 1.99, post_price_text="/lb"),
                ],
                "porc": [
                    _make_flipp_item(115, "EPAULE PICNIC DE PORC", "Maxi", 2.49, post_price_text="/lb"),
                ],
                "tomates": [
                    _make_flipp_item(116, "COULIS DE TOMATES", "Super C", 1.99, post_price_text="796 ml"),
                ],
            })
            update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )

            hist = json.loads(hist_path.read_text(encoding="utf-8"))
            h1w_obs = hist["byPostalCode"]["H1W"]
            self.assertNotIn("ground_chicken", h1w_obs)
            self.assertNotIn("chicken_breast", h1w_obs)
            self.assertIn("pork_shoulder", h1w_obs)
            self.assertNotIn("pork_loin_lean", h1w_obs)
            self.assertIn("diced_tomatoes", h1w_obs)
            self.assertNotIn("pico", h1w_obs)

    def test_zero_price_history_entry_rejected_without_blocking_historic_low(self) -> None:
        now = dt.datetime(2026, 11, 18, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            seeded = {
                "schemaVersion": "1.0.0",
                "windowWeeks": 52,
                "updatedAt": "2026-11-11T13:00:00Z",
                "byPostalCode": {
                    "H1W": {
                        "pork_loin_lean": [
                            self._seed_obs(28, now, "Maxi", 0.0, "ZERO POISON", "pork"),
                            self._seed_obs(21, now, "Maxi", 0.90, "LONGE 1", "pork"),
                            self._seed_obs(14, now, "Maxi", 1.05, "LONGE 2", "pork"),
                            self._seed_obs(7, now, "Maxi", 1.15, "LONGE 3", "pork"),
                        ],
                    },
                },
            }
            hist_path.write_text(json.dumps(seeded), encoding="utf-8")

            loaded = update_plan.load_and_prune_price_history(hist_path, now)
            loaded_prices = [e["cadPer100g"] for e in loaded["byPostalCode"]["H1W"]["pork_loin_lean"]]
            self.assertNotIn(0.0, loaded_prices)
            self.assertEqual(loaded_prices, [0.9, 1.05, 1.15])

            http_get = self._build_http_get({
                "porc": [
                    _make_flipp_item(
                        118,
                        "LONGE DE PORC DESOSSEE",
                        "Maxi",
                        1.99,
                        post_price_text="/lb",
                        valid_from="2026-11-12T05:00:00+00:00",
                        valid_to="2026-11-19T04:59:59+00:00",
                    ),
                ],
            })
            data = update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )
            pork_price = data["nutritionDb"]["pork_loin_lean"]["price"]
            self.assertTrue(pork_price["onFlyer"])
            self.assertEqual(pork_price["radarTag"], "HISTORIC LOW")
            self.assertGreater(pork_price["historicalLowCadPer100g"], 0.0)

    def test_tomato_size_requires_ml_or_canned_context(self) -> None:
        self.assertEqual(update_plan.resolve_deal_ingredient_id("tomatoes", "TOMATES CERISES 680 G"), "pico")
        self.assertEqual(
            update_plan.resolve_deal_ingredient_id("tomatoes", "TOMATES CERISES DU CANADA 680 G"),
            "pico",
        )
        self.assertEqual(update_plan.resolve_deal_ingredient_id("tomatoes", "TOMATES ROUGES 540 G"), "pico")
        self.assertEqual(
            update_plan.resolve_deal_ingredient_id("tomatoes", "TOMATES EN DES 796 ML"),
            "diced_tomatoes",
        )
        self.assertEqual(
            update_plan.resolve_deal_ingredient_id("tomatoes", "COULIS DE TOMATES 680 ML"),
            "diced_tomatoes",
        )
        self.assertEqual(
            update_plan.resolve_deal_ingredient_id("tomatoes", "TOMATES ITALIENNES 540 ML"),
            "diced_tomatoes",
        )

    def test_multi_cut_and_unmapped_cuts_do_not_shadow_tracked_ingredients(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            http_get = self._build_http_get({
                "poulet": [
                    _make_flipp_item(201, "CUISSES DE POULET AVEC DOS", "Maxi", 1.79, post_price_text="/lb"),
                    _make_flipp_item(202, "PILONS DE POULET FRAIS", "Maxi", 1.99, post_price_text="/lb"),
                    _make_flipp_item(203, "POULET HACHE EXTRA-MAIGRE", "Maxi", 2.99, post_price_text="/lb"),
                    _make_flipp_item(204, "POITRINES DE POULET DESOSSEES", "Maxi", 4.49, post_price_text="/lb"),
                    _make_flipp_item(205, "POULET HACHE EXTRA-MAIGRE", "Walmart", 1.50, post_price_text="/lb"),
                ],
                "porc": [
                    _make_flipp_item(206, "EPAULE DE PORC PICNIC", "Maxi", 1.99, post_price_text="/lb"),
                    _make_flipp_item(207, "LONGE DE PORC DESOSSEE", "Maxi", 2.99, post_price_text="/lb"),
                ],
                "tomates": [
                    _make_flipp_item(208, "TOMATES EN DES AYLMER 796 ML", "Maxi", 1.25),
                    _make_flipp_item(209, "TOMATES CERISES 680 G", "Maxi", 2.99),
                ],
                "thon": [
                    _make_flipp_item(210, "SARDINES BRUNSWICK 106 G", "Maxi", 0.99),
                    _make_flipp_item(211, "THON PALE DANS L'EAU 170 G", "Maxi", 1.49),
                ],
            })

            data = update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )

            db = data["nutritionDb"]
            # Chicken breast must not be shadowed by cheaper thighs/drumsticks/ground chicken
            self.assertTrue(db["chicken_breast"]["price"]["onFlyer"])
            self.assertEqual(db["chicken_breast"]["price"]["flyerItemName"], "POITRINES DE POULET DESOSSEES")
            # ground_chicken must remain strictly isolated
            self.assertFalse(db["ground_chicken"]["price"]["onFlyer"])
            self.assertEqual(db["ground_chicken"]["price"]["cadPer100g"], 1.10)

            # Simultaneous multi-cut deals must all update nutritionDb
            self.assertTrue(db["pork_shoulder"]["price"]["onFlyer"])
            self.assertTrue(db["pork_loin_lean"]["price"]["onFlyer"])
            self.assertTrue(db["diced_tomatoes"]["price"]["onFlyer"])
            self.assertTrue(db["pico"]["price"]["onFlyer"])
            self.assertEqual(db["pico"]["price"]["flyerItemName"], "TOMATES CERISES 680 G")
            self.assertTrue(db["sardines_water"]["price"]["onFlyer"])
            self.assertTrue(db["tuna_water"]["price"]["onFlyer"])

            hist = json.loads(hist_path.read_text(encoding="utf-8"))
            h1w_obs = hist["byPostalCode"]["H1W"]
            for ing_id in (
                "chicken_breast",
                "pork_shoulder",
                "pork_loin_lean",
                "diced_tomatoes",
                "pico",
                "sardines_water",
                "tuna_water",
            ):
                self.assertIn(ing_id, h1w_obs, msg=f"Missing {ing_id} in price_history")
            self.assertNotIn("ground_chicken", h1w_obs)

    def test_save_price_history_atomic_preserves_existing_file_on_replace_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            original = {"schemaVersion": "1.0.0", "windowWeeks": 52, "updatedAt": "2026-11-12T13:00:00Z", "byPostalCode": {}}
            update_plan.save_price_history(hist_path, original)
            original_bytes = hist_path.read_bytes()

            with patch.object(update_plan.os, "replace", side_effect=OSError("disk replace failed")):
                with self.assertRaises(OSError):
                    update_plan.save_price_history(hist_path, {"schemaVersion": "1.0.0", "windowWeeks": 52, "updatedAt": "2026-11-19T13:00:00Z", "byPostalCode": {"H1W": {}}})

            self.assertEqual(hist_path.read_bytes(), original_bytes)
            leftover_tmps = list(tmp_path.glob("*.tmp"))
            self.assertEqual(leftover_tmps, [])

    def test_r4_excluded_scope_no_leftover_or_partial_package_rollover(self) -> None:
        now = dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc)
        script_src = (ROOT_DIR / "scripts" / "update_plan.py").read_text(encoding="utf-8").lower()
        root_hist_src = (ROOT_DIR / "price_history.json").read_text(encoding="utf-8").lower()

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            hist_path = tmp_path / "price_history.json"
            http_get = self._build_http_get({
                "porc": [
                    _make_flipp_item(117, "LONGE DE PORC DESOSSEE", "Maxi", 2.99, post_price_text="/lb"),
                ],
            })
            data = update_plan.run_pipeline(
                output_dir=tmp_path,
                now=now,
                postal_code="H1W",
                api_key="",
                http_get=http_get,
                history_path=hist_path,
            )
            generated_hist_src = hist_path.read_text(encoding="utf-8").lower()
            generated_data_src = json.dumps(data).lower()

            for forbidden in (
                "leftover",
                "rollover",
                "roll_over",
                "partial_package",
                "partialpackage",
                "pantry_credit",
                "carry_over",
                "surplus_grams",
            ):
                self.assertNotIn(forbidden, script_src)
                self.assertNotIn(forbidden, root_hist_src)
                self.assertNotIn(forbidden, generated_hist_src)
                self.assertNotIn(forbidden, generated_data_src)


if __name__ == "__main__":
    unittest.main()
