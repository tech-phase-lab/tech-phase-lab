"""週刊 Tech Phase PRO auto-draft: evidence, numbers built by the program, checks on the model's sentences, the weekly schedule."""
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import market_results
import weekly_generator as gen
import weekly_issues as weekly

JST = ZoneInfo("Asia/Tokyo")
SATURDAY = datetime(2026, 11, 7, 8, 30, tzinfo=JST).timestamp()
ENV = {"OPENAI_API_KEY": "sk-test-" + "x" * 30, "RESEARCH_DEEP_MODEL": "test-model-1"}


def make_db(path):
    db = weekly.connect(path)
    market_results.schema(db)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS signal_events(id INTEGER PRIMARY KEY, url TEXT);
      CREATE TABLE IF NOT EXISTS official_research_publications(event_id INTEGER PRIMARY KEY, sha TEXT, body_sha TEXT, payload TEXT, evidence TEXT, started_at TEXT, public_at TEXT, generation_ms INTEGER);
    """)
    return db


def publish_flash(db, event_id, item, at):
    db.execute("INSERT INTO market_result_publications(event_id,source_id,url,sha,payload,published_at,processing_ms) VALUES(?,?,?,?,?,?,0)",
               (event_id, "s", item["url"], "sha", json.dumps(item), at))


MU = {"kind": "earnings", "ticker": "MU", "period": "Q4 2026", "url": "https://x.com/tipranks/status/1",
      "facts": [{"key": "revenue", "ja": "売上高", "en": "Revenue", "value": "$11.32B"},
                {"key": "eps", "ja": "EPS", "en": "EPS", "value": "$2.51"},
                {"key": "guidance-revenue", "ja": "会社見通し 売上高", "en": "Guidance Revenue", "value": "$12.5B ± $300M"}],
      "titleJa": "MU Q4 2026決算：売上高$11.32B、EPS$2.51", "titleEn": "MU Q4 2026 earnings: Revenue $11.32B, EPS $2.51"}
JOBS = {"kind": "economic", "ticker": "ECON", "period": "OCTOBER JOBS REPORT", "url": "https://x.com/tipranks/status/2",
        "facts": [{"key": "nonfarm-payrolls", "ja": "非農業部門雇用者数", "en": "Nonfarm payrolls", "value": "29K", "comparisons": {"forecast": "50K", "previous": "133K"}},
                  {"key": "unemployment-rate", "ja": "失業率", "en": "Unemployment rate", "value": "4.2%", "comparisons": {"previous": "4.1%"}}],
        "titleJa": "非農業部門雇用者数 29K／失業率 4.2%", "titleEn": "Nonfarm payrolls 29K; Unemployment rate 4.2%"}


def part(kind, **over):
    base = {"type": kind, "heading": None, "body": None, "note": None, "text": None, "title": None, "evidenceIds": [], "refs": [], "points": []}
    return {**base, **over}


def model_output(**over):
    value = {"headline": "MU決算と、雇用統計の弱さが残した宿題", "lead": "MUは増収で、雇用統計は弱めでした。見立ては割れそうです。",
             "parts": [
                 part("numbers", heading="MUの決算", note="利益率は別に確認します。", evidenceIds=["E1"], refs=[{"evidenceId": "E1", "factKey": "revenue"}, {"evidenceId": "E1", "factKey": "eps"}]),
                 part("text", heading="雇用統計は弱め", body="非農業部門雇用者数は29Kで、市場予想の50Kを下回りました。失業率は4.2%です。", evidenceIds=["E2"]),
                 part("timeline", heading="金曜の流れ", evidenceIds=["E2"], points=[
                     {"when": "発表前", "event": "予想は強めでした", "comment": None, "tone": "flat", "evidenceIds": ["E2"]},
                     {"when": "発表後", "event": "予想を下回りました", "comment": "金利への見方が変わるかもしれません。", "tone": "down", "evidenceIds": ["E2"]}]),
                 part("highlight", text="数字より先に、流れを見ましょう。"),
             ], "scheduleComments": [], "skipped": []}
    value.update(over)
    return value


class FakeModel:
    def __init__(self, output):
        self.output, self.calls = output, []

    def __call__(self, payload, key):
        self.calls.append(payload)
        return {"status": "completed", "output_text": json.dumps(self.output, ensure_ascii=False)}


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "w.sqlite"
        self.db = make_db(self.path)
        publish_flash(self.db, 1, MU, "2026-11-05T21:30:00+00:00")
        publish_flash(self.db, 2, JOBS, "2026-11-06T13:31:00+00:00")
        publish_flash(self.db, 3, {**MU, "ticker": "OLD", "url": "https://x.com/tipranks/status/9"}, "2026-10-01T00:00:00+00:00")
        self.db.commit()

    def tearDown(self):
        self.db.close(); self.temp.cleanup()


class ParseTests(unittest.TestCase):
    def test_figures_become_exact_card_values_with_japanese_units(self):
        self.assertEqual(gen.parse_value("$11.32B"), (113.2, "億ドル"))
        self.assertEqual(gen.parse_value("$542.29M"), (542.29, "百万ドル"))
        self.assertEqual(gen.parse_value("$2.51"), (2.51, "ドル"))
        self.assertEqual(gen.parse_value("41.5%"), (41.5, "%"))
        self.assertEqual(gen.parse_value("−0.2%"), (-0.2, "%"))
        self.assertEqual(gen.parse_value("29K", "nonfarm-payrolls"), (29000.0, "人"))
        self.assertEqual(gen.parse_value("NT$763.1B"), (7631.0, "億台湾ドル"))
        self.assertIsNone(gen.parse_value("about $5B"))
        self.assertIsNone(gen.parse_value("₩5T"))


class WhenTests(Base):
    def at(self, day, hour, minute=0):
        return datetime(2026, 11, day, hour, minute, tzinfo=JST).timestamp()

    def test_it_runs_once_on_saturday_after_the_chosen_hour_and_only_when_turned_on(self):
        self.assertFalse(gen.due(self.db, self.at(7, 9)), "off by default")
        weekly.save_settings(self.db, {"generateEnabled": True})
        self.assertFalse(gen.due(self.db, self.at(6, 9)), "Friday")
        self.assertFalse(gen.due(self.db, self.at(7, 7, 59)), "before 08:00")
        self.assertTrue(gen.due(self.db, self.at(7, 8)))
        self.assertTrue(gen.due(self.db, self.at(7, 23)), "a restart later that day still makes it")
        self.assertFalse(gen.due(self.db, self.at(8, 9)), "Sunday is too late")
        weekly.save_settings(self.db, {"generateHour": 10})
        self.assertFalse(gen.due(self.db, self.at(7, 9)))
        self.assertTrue(gen.due(self.db, self.at(7, 10)))
        with self.assertRaises(ValueError):
            weekly.save_settings(self.db, {"generateHour": 24})
        with self.assertRaises(ValueError):
            weekly.save_settings(self.db, {"generateEnabled": "yes"})


class CollectTests(Base):
    def test_only_this_weeks_checked_results_are_evidence_and_each_has_an_id(self):
        news = [{"title": "半導体株が上昇", "url": "https://example.com/n1"}, {"title": "", "url": "https://example.com/n2"}, {"title": "http only", "url": "http://x"}]
        evidence = gen.collect(self.db, SATURDAY, news)
        self.assertEqual([item["id"] for item in evidence], ["E1", "E2", "E3"])
        self.assertEqual([item["kind"] for item in evidence], ["earnings", "indicator", "news"])
        self.assertNotIn("OLD", json.dumps(evidence), "a result from last month is not this week's")
        self.assertIn("Revenue: $11.32B", evidence[0]["quote"])
        self.assertIn("forecast 50K", evidence[1]["quote"])

    def test_next_weeks_schedule_comes_from_the_schedule_the_service_keeps(self):
        rows = gen.upcoming(SATURDAY)
        self.assertTrue(rows and all("2026-11-08" <= row["date"] < "2026-11-17" for row in rows))
        self.assertTrue(any("CPI" in row["name"] for row in rows))


class GenerateTests(Base):
    def test_a_draft_is_made_with_numbers_built_by_the_program_and_it_is_marked_automatic(self):
        model = FakeModel(model_output())
        saved = gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        self.assertEqual((saved["status"], saved["auto"], saved["number"]), ("draft", True, None))
        self.assertEqual(saved["date"], "2026-11-07")
        numbers = next(p for p in saved["parts"] if p["type"] == "numbers")
        revenue = numbers["cards"][0]
        self.assertEqual((revenue["label"], revenue["value"], revenue["unit"], revenue["outlook"], revenue["outlookUnit"]), ("MU 売上高", 113.2, "億ドル", 125.0, "億ドル"))
        self.assertIn("会社見通し $12.5B ± $300M", revenue["range"])
        self.assertEqual(numbers["cards"][1]["value"], 2.51)
        self.assertEqual(saved["parts"][-1]["type"], "schedule", "next week's schedule is always there")
        self.assertTrue(any("CPI" in item["name"] for item in saved["parts"][-1]["items"]))
        self.assertEqual({s["url"] for s in saved["sources"]}, {MU["url"], JOBS["url"]})
        self.assertEqual(weekly.member_issues(self.db)["issues"], [], "a draft is never visible to members")
        sent = json.loads(model.calls[0]["input"])
        self.assertEqual([e["id"] for e in sent["evidence"]], ["E1", "E2"])
        self.assertEqual(sent["recentIssues"], [], "no earlier issue yet")
        self.assertIn("数字は、資料に書かれた値だけ", model.calls[0]["instructions"])
        self.assertIs(model.calls[0]["store"], False)

    def test_a_sentence_with_a_number_the_evidence_does_not_have_is_left_out_and_noted(self):
        out = model_output()
        out["parts"][1] = part("text", heading="雇用統計は強め", body="非農業部門雇用者数は45Kでした。", evidenceIds=["E2"])
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        kinds = [p["type"] for p in saved["parts"]]
        self.assertNotIn("text", kinds)
        self.assertIn("numbers", kinds)
        self.assertIn("数字が食い違った: 雇用統計は強め", saved["notes"])

    def test_the_headline_with_an_unsupported_number_stops_the_draft(self):
        with self.assertRaises(ValueError):
            gen.generate(self.db, SATURDAY, transport=FakeModel(model_output(headline="MUは売上高99億ドルでした")), env=ENV)

    def test_a_bar_chart_needs_two_figures_in_the_same_unit(self):
        out = model_output()
        out["parts"].append(part("chart", heading="比べる", title="売上と見通し", evidenceIds=["E1"],
                                 refs=[{"evidenceId": "E1", "factKey": "revenue"}, {"evidenceId": "E1", "factKey": "eps"}]))
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        self.assertNotIn("chart", [p["type"] for p in saved["parts"]], "億ドル and ドル do not share a bar chart")
        self.assertTrue(any("比べる" in note for note in saved["notes"]))
        out["parts"][-1]["refs"] = [{"evidenceId": "E1", "factKey": "revenue"}, {"evidenceId": "E1", "factKey": "guidance-revenue"}]
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        chart = next(p for p in saved["parts"] if p["type"] == "chart")
        self.assertEqual([bar["value"] for bar in chart["bars"]], [113.2, 125.0])
        self.assertEqual(chart["unit"], "億ドル")

    def test_a_missing_kind_of_material_is_written_down_and_the_rest_is_made(self):
        self.db.execute("DELETE FROM market_result_publications WHERE event_id=2"); self.db.commit()
        out = model_output()
        out["parts"] = [out["parts"][0]]
        out["skipped"] = ["雇用統計"]
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        self.assertIn("ここは取れませんでした: 今週に結果が出た指標", saved["notes"])
        self.assertIn("ここは取れませんでした: 雇用統計", saved["notes"])
        self.assertIn("numbers", [p["type"] for p in saved["parts"]])

    def test_nothing_to_write_from_means_no_draft_and_no_model_call(self):
        self.db.execute("DELETE FROM market_result_publications"); self.db.commit()
        model = FakeModel(model_output())
        with self.assertRaisesRegex(RuntimeError, "weekly-no-evidence"):
            gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        self.assertEqual(model.calls, [])
        with self.assertRaisesRegex(RuntimeError, "weekly-not-configured"):
            gen.generate(self.db, SATURDAY, transport=model, env={})

    def test_the_response_schema_is_strict_for_the_model_api(self):
        def walk(node):
            if isinstance(node, dict):
                if node.get("type") == "object":
                    self.assertIs(node.get("additionalProperties"), False)
                    self.assertEqual(sorted(node["required"]), sorted(node["properties"]))
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)
        walk(gen.response_schema())
        json.dumps(gen.response_schema())


class RecentTests(Base):
    def test_the_model_is_shown_the_last_published_issues_to_avoid_the_same_opening(self):
        for number in range(1, 5):
            made = weekly.save_draft(self.db, {"date": "2026-10-0" + str(number), "headline": f"号{number}の見出し", "lead": f"号{number}のひとこと。",
                                               "parts": [{"type": "text", "heading": "本文", "body": "本文です。"}], "sources": []})["item"]
            weekly.publish(self.db, {"id": made["id"]})
        model = FakeModel(model_output())
        gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        sent = json.loads(model.calls[0]["input"])
        self.assertEqual([r["headline"] for r in sent["recentIssues"]], ["号4の見出し", "号3の見出し", "号2の見出し"])


class RunTests(Base):
    def test_the_poll_loop_makes_one_draft_a_week_and_retries_a_failure_a_few_times(self):
        weekly.save_settings(self.db, {"generateEnabled": True}); self.db.commit()
        failing = lambda payload, key: (_ for _ in ()).throw(RuntimeError("boom"))
        self.assertEqual(gen.run_if_due(self.path, SATURDAY, transport=failing, env=ENV), "retry")
        self.assertEqual(gen.run_if_due(self.path, SATURDAY + 60, transport=failing, env=ENV), "idle", "waits before trying again")
        model = FakeModel(model_output())
        self.assertEqual(gen.run_if_due(self.path, SATURDAY + gen.RETRY_SECONDS + 1, transport=model, env=ENV), "done")
        self.assertEqual(gen.run_if_due(self.path, SATURDAY + 4000, transport=model, env=ENV), "idle", "once a week")
        self.assertEqual(len(model.calls), 1)
        with weekly.connect(self.path) as db:
            self.assertEqual(len(weekly.owner_view(db)["drafts"]), 1)
            self.assertEqual(weekly.settings(db)["lastGenerated"], gen.week_key(SATURDAY))

    def test_it_gives_up_after_three_failures_in_a_week(self):
        weekly.save_settings(self.db, {"generateEnabled": True}); self.db.commit()
        failing = lambda payload, key: (_ for _ in ()).throw(RuntimeError("boom"))
        for attempt in range(3):
            self.assertEqual(gen.run_if_due(self.path, SATURDAY + attempt * (gen.RETRY_SECONDS + 5), transport=failing, env=ENV), "retry")
        self.assertEqual(gen.run_if_due(self.path, SATURDAY + 4 * (gen.RETRY_SECONDS + 5), transport=FakeModel(model_output()), env=ENV), "idle")

    def test_when_the_owner_turned_on_automatic_publication_the_draft_is_published_at_once(self):
        weekly.save_settings(self.db, {"generateEnabled": True, "autoPublish": True}); self.db.commit()
        self.assertEqual(gen.run_if_due(self.path, SATURDAY, transport=FakeModel(model_output()), env=ENV), "done")
        with weekly.connect(self.path) as db:
            self.assertEqual(weekly.member_issues(db)["issues"][0]["number"], 1)


if __name__ == "__main__":
    unittest.main()
