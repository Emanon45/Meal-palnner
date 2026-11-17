"""Comprehensive unit and end-to-end tests for scripts/update_plan.py."""

from __future__ import annotations

import datetime as dt
import json
import os
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

    def test_gemini_oil_violation_triggers_deterministic_fallback(self) -> None:
        bad_payload = {
            "weeklyTheme": "Savory Week",
            "produceRotationNote": "Fresh veggies",
            "fruitRotationNote": "Fresh fruit",
            "mealCustomizations": {
                "breakfast": {"seasoningTwist": "Drizzle 1 tbsp olive oil over potatoes"},
                "lunch": {"seasoningTwist": "Sumac and lemon"},
                "dinner": {"seasoningTwist": "Ginger and garlic"},
                "snack": {"seasoningTwist": "Cinnamon"},
            },
            "prepTips": [],
        }
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = SimpleNamespace(text=json.dumps(bad_payload))

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
        self.assertEqual(ai_source, "fallback")
        self.assertEqual(update_plan.validate_zero_added_oil(plan), [])

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

    def test_all_fallback_profiles_pass_zero_oil_check(self) -> None:
        self.assertEqual(update_plan.validate_zero_added_oil(update_plan.FALLBACK_PROFILES), [])
        self.assertEqual(update_plan.validate_zero_added_oil(update_plan.BASE_MEAL_TEMPLATES), [])
        self.assertEqual(update_plan.validate_zero_added_oil(update_plan.BASE_PREP_TIMELINE), [])


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
        }
        self.assertEqual(set(data.keys()), expected_top)
        self.assertEqual(data["schemaVersion"], "1.0.0")
        self.assertIn(data["source"], {"gemini+flipp", "gemini+baseline", "fallback+flipp", "fallback+baseline"})
        self.assertIn(data["winningStore"], {"Maxi", "Super C"})
        self.assertEqual(data["location"]["postalCodeDisplay"], "H1W")
        self.assertEqual(data["location"]["postalCodeQuery"], "H1W1A1")
        self.assertEqual(data["location"]["groceryTaxRate"], 0.0)
        self.assertTrue(data["userProfile"]["zeroAddedOil"])

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
            self.assertTrue(step["zeroOilNote"])

        self.assertEqual(update_plan.validate_zero_added_oil(data["mealTemplates"]), [])
        self.assertEqual(update_plan.validate_zero_added_oil(data["prepTimeline"]), [])

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

    def test_fallback_pipeline_excludes_oil_deals_and_never_crashes_zero_oil_check(self) -> None:
        now = dt.datetime(2026, 11, 17, 13, 0, 0, tzinfo=dt.timezone.utc)

        # Even if raw deals passed directly to build_fallback_plan contain oil/beurre keywords,
        # weeklyTheme filters them out so sanitize_zero_oil passes.
        plan = update_plan.build_fallback_plan(
            "Maxi",
            deals={
                "canned_fish": {"name": "THON PALE DANS L'HUILE 170G"},
                "potatoes": {"name": "POMMES DE TERRE AU BEURRE"},
                "pork": {"name": "FILET DE PORC FRAIS"},
            },
            flyer_period={"validFrom": "2026-11-12", "validTo": "2026-11-18"},
        )
        self.assertEqual(update_plan.validate_zero_added_oil(plan), [])
        self.assertIn("FILET DE PORC FRAIS", plan["mealTemplates"]["weeklyTheme"])
        self.assertNotIn("HUILE", plan["mealTemplates"]["weeklyTheme"])
        self.assertNotIn("BEURRE", plan["mealTemplates"]["weeklyTheme"])

        # End-to-end run_pipeline(api_key="") with oil/butter flyer items must exclude them cleanly
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
                        _make_flipp_item(303, "POMMES DE TERRE AU BEURRE 500G", "Maxi", 1.99),
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
            self.assertEqual(data["nutritionDb"]["tuna_water"]["price"]["flyerItemName"], "THON PALE DANS L'EAU 170G")
            self.assertFalse(data["nutritionDb"]["potatoes_raw"]["price"]["onFlyer"])
            self.assertEqual(update_plan.validate_zero_added_oil(data["mealTemplates"]), [])

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


if __name__ == "__main__":
    unittest.main()
