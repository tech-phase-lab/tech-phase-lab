"""週刊 Tech Phase PRO auto-draft: evidence, numbers built by the program, checks on the model's sentences, the weekly schedule."""
import json
from unittest import mock
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


REJECTED = "ブロードコム、出荷遅延を見込む"
real_semantics = gen.factual_validation.validate_semantics


def semantics_rejecting_the_headline(text, evidence, **options):
    # Stands in for the production rule that rejected a headline with "changed-negation" (owner, Nov 11).
    if text == REJECTED:
        raise ValueError("changed-negation")
    return real_semantics(text, evidence, **options)


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
        self.assertEqual([e["id"] for e in sent["evidence"]][:2], ["E1", "E2"])
        self.assertEqual({e["type"] for e in sent["evidence"][2:]}, {"schedule"}, "next week's releases are evidence the sentences may cite")
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
        self.assertIn("【要確認】「雇用統計は強め」は、数字が資料と合わないため載せていません。〔unsupported-number〕", saved["notes"])

    def test_a_headline_with_an_unsupported_number_is_never_published_and_the_model_is_not_asked_again(self):
        # Owner, Nov 15 (cost): one model call; a wrong number is replaced here and flagged for the owner, the rest of the issue is kept.
        model = FakeModel(model_output(headline="MUは売上高99億ドルでした"))
        saved = gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        self.assertEqual(len(model.calls), 1)
        self.assertNotIn("99", saved["headline"])
        self.assertEqual(saved["headline"], "11/7号：MU決算と米雇用統計")
        self.assertIn("【要確認】見出しは、数字が資料と合わないため、AIの文を使わず定型文にしています。〔unsupported-number〕", saved["notes"])
        self.assertTrue(any(p["type"] == "numbers" for p in saved["parts"]), "the rest of the issue is kept")
        with self.assertRaises(ValueError):
            gen.compose(model_output(headline="MUは売上高99億ドルでした"), gen.collect(self.db, SATURDAY), [])

    def test_a_headline_rejected_for_negation_is_asked_again_and_then_replaced_by_a_plain_one(self):
        # Owner, Nov 11: "changed-negation" stopped the whole Saturday issue. A negation the check reads against the evidence is not a wrong number.
        bad = model_output(headline=REJECTED)
        with mock.patch.object(gen.factual_validation, "validate_semantics", semantics_rejecting_the_headline):
            saved = gen.generate(self.db, SATURDAY, transport=FakeModel(bad), env=ENV)
        self.assertEqual(saved["headline"], "11/7号：MU決算と米雇用統計", "the fallback is built from the week, not one fixed line")
        self.assertTrue(any("見出し" in note for note in saved["notes"]))

    def test_a_rejected_headline_is_not_sent_back_to_the_model(self):
        # Owner, Nov 15 (cost): no second round. The draft is made from the one answer.
        model = FakeModel(model_output(headline=REJECTED))
        with mock.patch.object(gen.factual_validation, "validate_semantics", semantics_rejecting_the_headline):
            saved = gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        self.assertEqual(len(model.calls), 1)
        self.assertNotIn("repair", json.loads(model.calls[0]["input"]))
        self.assertEqual(saved["lead"], model_output()["lead"], "the lead that passed is kept")

    def test_the_body_is_reader_text_in_a_fixed_order_and_the_owner_lines_are_tagged_notes(self):
        out = model_output()
        out["takeaways"] = [{"text": "MUは増収で、見通しも強めでした。", "evidenceIds": ["E1"]},
                            {"text": "雇用統計は予想を下回りました。", "evidenceIds": ["E2"]},
                            {"text": "MUの売上高は99億ドルでした。", "evidenceIds": ["E1"]}]  # a wrong figure: left out, noted
        out["parts"] = out["parts"][1:]  + [out["parts"][0]]  # the model put the indicator first and the earnings after
        out["skipped"] = ["QCOMの決算数値は、論点を絞るため掲載を見送りました。"]
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        sections = [p["section"] for p in saved["parts"]]
        self.assertEqual(sections[0], "summary"); self.assertEqual(sections[-1], "schedule")
        self.assertEqual([s for s in sections if s not in ("summary", "schedule")], sorted((s for s in sections if s not in ("summary", "schedule")), key=("earnings", "indicators", "market").index))
        self.assertLess(sections.index("earnings"), sections.index("indicators"))
        summary = saved["parts"][0]
        self.assertEqual(summary["heading"], "今週の主な結論")
        self.assertEqual(summary["body"].split("\n"), ["・MUは増収で、見通しも強めでした。", "・雇用統計は予想を下回りました。"])
        body_text = json.dumps(saved["parts"], ensure_ascii=False)
        for leak in ("取れませんでした", "見送りました", "changed-", "unsupported-number", "AIの文が"):
            self.assertNotIn(leak, body_text, "owner-only lines never reach the body")
        self.assertTrue(all(line.startswith(("【要確認】", "【定型文】", "【取得なし】", "【AI省略】")) for line in saved["notes"]))
        self.assertTrue(saved["notes"][0].startswith("【要確認】"), "lines that need the owner come first")
        self.assertTrue(saved["notes"][-1].startswith("【AI省略】"))
        self.assertTrue(any("〔unsupported-number〕" in line for line in saved["notes"]), "the error code lives in the memo")

    def test_a_substituted_headline_is_marked_in_the_memo_with_its_code_and_notes_are_deduplicated_and_capped(self):
        notes = [gen.note(gen.OMITTED, "x")] + [gen.note(gen.ATTENTION, f"n{i}") for i in range(40)] + [gen.note(gen.ATTENTION, "n1")]
        done = gen.finish_notes(notes)
        self.assertEqual(len(done), gen.MAX_NOTES)
        self.assertEqual(len(set(done)), len(done))
        self.assertTrue(done[0].startswith("【要確認】"))
        self.assertEqual(gen.note(gen.SUBSTITUTED, "見出しは定型文にしています。", "changed-negation"), "【定型文】見出しは定型文にしています。〔changed-negation〕")

    def test_the_numbers_part_carries_result_forecast_previous_bars_only_from_checked_figures_in_one_unit(self):
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(model_output()), env=ENV)
        self.assertEqual(next(p for p in saved["parts"] if p["type"] == "numbers")["compare"], [], "revenue and EPS have no forecast or previous in the evidence")
        out = model_output()
        out["parts"].append(part("numbers", heading="雇用統計の数字", evidenceIds=["E2"], refs=[{"evidenceId": "E2", "factKey": "nonfarm-payrolls"}, {"evidenceId": "E2", "factKey": "unemployment-rate"}]))
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        jobs = next(p for p in saved["parts"] if p["type"] == "numbers" and p["heading"] == "雇用統計の数字")
        self.assertEqual(jobs["compare"][0], {"label": "非農業部門雇用者数", "unit": "人", "values": [{"name": "結果", "value": 29000.0}, {"name": "予想", "value": 50000.0}, {"name": "前回", "value": 133000.0}]})
        self.assertEqual([v["name"] for v in jobs["compare"][1]["values"]], ["結果", "前回"], "no forecast for the unemployment rate: two bars")
        mixed = {"key": "x", "value": "29K", "comparisons": {"forecast": "4.2%"}}
        self.assertIsNone(gen.build_compare([{"id": "E1", "facts": [mixed], "ticker": ""}], {"evidenceId": "E1", "factKey": "x"}), "units differ: no bars")

    def test_the_program_calculates_the_gaps_and_the_model_only_copies_them(self):
        lines = gen.derived_lines(gen.collect(self.db, SATURDAY)[0]["facts"] + gen.collect(self.db, SATURDAY)[1]["facts"])
        self.assertIn("計算 売上高: 次期の会社見通しは今回の結果比 +10.4%", lines)
        self.assertIn("計算 非農業部門雇用者数: 予想比 -42.0%、前回比 -78.2%", lines)
        self.assertIn("計算 失業率: 前回との差 +0.1pt", lines)
        model = FakeModel(model_output())
        gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        sent = json.loads(model.calls[0]["input"])
        self.assertIn("計算 非農業部門雇用者数: 予想比 -42.0%、前回比 -78.2%", sent["evidence"][1]["calculated"])

    def test_a_takeaway_with_a_calculated_figure_a_named_release_and_a_hedged_view_is_accepted_and_a_made_up_figure_is_not(self):
        out = model_output()
        out["takeaways"] = [
            {"text": "MUの売上高は$11.32Bで、次期の会社見通しは今回の結果比で+10.4%でした。", "evidenceIds": ["E1"]},
            {"text": "非農業部門雇用者数は予想比で-42.0%と弱く、金利低下への期待が出るという見方です。", "evidenceIds": ["E2"]},
            {"text": "雇用統計は予想比で-60.0%でした。", "evidenceIds": ["E2"]}]
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        body = saved["parts"][0]["body"]
        self.assertIn("+10.4%", body); self.assertIn("-42.0%", body); self.assertNotIn("-60.0%", body, "a figure the evidence does not have is left out")
        self.assertTrue(any("〔unsupported-number〕" in n for n in saved["notes"]))

    def test_a_takeaway_may_name_next_weeks_releases_and_the_policy_asks_for_figures_names_and_the_tech_view(self):
        model = FakeModel(model_output())
        gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        schedule = [e for e in json.loads(model.calls[0]["input"])["evidence"] if e["type"] == "schedule"]
        ids = [e["id"] for e in schedule if "CPI" in e["label"] or "PPI" in e["label"]]
        out = model_output()
        out["takeaways"] = [{"text": "来週は米国CPI（消費者物価指数）と米国PPI（生産者物価指数）の発表が控えており、利下げ観測を左右するという見方です。", "evidenceIds": ids}]
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        self.assertIn("米国CPI（消費者物価指数）", saved["parts"][0]["body"])
        for phrase in ("ハイテク・半導体株にとって何を意味するか", "具体的な数字", "米CPI(消費者物価指数)", "「物価の発表」のような曖昧な書き方はしません", "計算"):
            self.assertIn(phrase, gen.POLICY)

    def test_each_takeaway_keeps_the_kind_of_material_it_rests_on_for_its_icon(self):
        out = model_output()
        out["takeaways"] = [{"text": "MUは増収で、見通しも強めでした。", "evidenceIds": ["E1"]}, {"text": "雇用統計は予想を下回りました。", "evidenceIds": ["E2"]}]
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        self.assertEqual([i["kind"] for i in saved["parts"][0]["items"]], ["earnings", "indicators"])

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
        self.assertIn(gen.note(gen.MISSING, "今週に結果が出た経済指標が、集まっていません。"), saved["notes"])
        self.assertIn(gen.note(gen.OMITTED, "AIが載せなかった話題: 雇用統計"), saved["notes"])
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


class DepthAndFiguresTests(Base):
    """Owner, Nov 15: the draft had no figure and read like the news; PRO readers need more than that."""

    def test_the_weeks_deep_analyses_are_evidence_and_count_as_earnings(self):
        self.db.executescript("""CREATE TABLE IF NOT EXISTS deep_analyses(source_ref TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL,
          source_sha TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at REAL NOT NULL DEFAULT 0, model TEXT, payload TEXT,
          failure TEXT, created_at TEXT NOT NULL, published_at TEXT, source_url TEXT, source_title TEXT)""")
        note = {"headline": {"ja": "MUはHBMの比率が上がりました", "en": "HBM mix rose at MU"},
                "points": [{"ja": "データセンター向けが売上高$11.32Bをけん引しました。", "en": "Data center drove revenue of $11.32B."},
                           {"ja": "粗利益率の見通しを確認したいところです。", "en": "Gross margin guidance is worth checking."}], "watch": None}
        for ref, state, at in (("a", "done", "2026-11-06T00:00:00+00:00"), ("b", "held", "2026-11-06T00:00:00+00:00"), ("c", "done", "2026-10-01T00:00:00+00:00")):
            self.db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,payload,created_at,published_at,source_url) VALUES(?,?,?,?,?,?,?,?,?)",
                            (ref, "earnings", "MU", "s", state, json.dumps(note, ensure_ascii=False), at, at, "https://investors.micron.com/x"))
        self.db.commit()
        evidence = gen.collect(self.db, SATURDAY)
        analyses = [item for item in evidence if item["kind"] == "analysis"]
        self.assertEqual(len(analyses), 1, "only this week's published analyses")
        self.assertIn("$11.32B", analyses[0]["quote"])
        self.assertEqual(analyses[0]["ticker"], "MU")
        self.assertEqual(gen.section_of("text", [analyses[0]["id"]], evidence), "earnings")
        model = FakeModel(model_output())
        gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        self.assertIn("analysis", {e["type"] for e in json.loads(model.calls[0]["input"])["evidence"]})
        self.assertIn("type が analysis の資料は", model.calls[0]["instructions"])

    def test_figures_are_added_by_the_program_when_the_model_chose_none(self):
        out = model_output()
        out["parts"] = [p for p in out["parts"] if p["type"] != "numbers"]
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        numbers = [p for p in saved["parts"] if p["type"] == "numbers"]
        self.assertEqual([p["heading"] for p in numbers], ["決算の数字", "経済指標の数字"])
        self.assertEqual(numbers[0]["cards"][0]["label"], "MU 売上高")
        jobs = numbers[1]
        self.assertTrue(jobs["compare"], "result / forecast / previous bars for the indicator")
        self.assertEqual([v["name"] for v in jobs["compare"][0]["values"]], ["結果", "予想", "前回"])

    def test_a_text_about_companies_carries_their_tickers_for_the_photos(self):
        out = model_output()
        out["parts"].append(part("text", heading="MUはどうか?", body="MUは売上高$11.32Bでした。", evidenceIds=["E1"]))
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(out), env=ENV)
        about = next(p for p in saved["parts"] if p.get("heading") == "MUはどうか?")
        self.assertEqual(about["tickers"], ["MU"])
        jobs = next(p for p in saved["parts"] if p.get("heading") == "雇用統計は弱め")
        self.assertNotIn("tickers", jobs, "an indicator text names no company")
        with self.assertRaises(ValueError):
            weekly.validate({**saved, "parts": [{**about, "tickers": ["mu; drop"]}]})

    def test_figures_the_model_chose_are_not_doubled(self):
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(model_output()), env=ENV)
        headings = [p["heading"] for p in saved["parts"] if p["type"] == "numbers"]
        self.assertEqual(headings.count("決算の数字"), 0, "the model's own earnings figures stay; none added for that section")
        self.assertIn("経済指標の数字", headings)


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


class HeadlineTests(Base):
    """Owner, Nov 15: every draft was titled 「今週の決算と経済指標のまとめ」. A negated sentence anywhere in the week (here an official note saying the
    company did not change its buyback plan) made every affirmative Japanese headline fail with changed-negation, so the fixed line was used."""

    def add_note(self, en, ja="会社は自社株買いの計画を変えていません。"):
        self.db.execute("INSERT INTO signal_events(id,url) VALUES(7,'https://example.com/note')")
        payload = {"title": {"ja": "MUの公式発表", "en": "Micron update"}, "summary": {"ja": ja, "en": en}, "facts": []}
        self.db.execute("INSERT INTO official_research_publications(event_id,sha,body_sha,payload,evidence,started_at,public_at,generation_ms) VALUES(7,'s','b',?,'[]',?,?,0)",
                        (json.dumps(payload, ensure_ascii=False), "2026-11-06T00:00:00+00:00", "2026-11-06T00:00:00+00:00"))
        self.db.commit()

    def test_a_conclusion_style_headline_is_kept_although_another_sentence_of_the_week_is_negated(self):
        self.add_note("Micron did not change its buyback plan.")
        everything = "\n".join(item["quote"] for item in gen.collect(self.db, SATURDAY))
        # Before the fix: the same headline failed against the whole week joined together.
        with self.assertRaises(ValueError):
            gen.factual_validation.validate_semantics("MUは増収で、AI向けメモリの強さが続いています", everything + "\n米CPI")
        headline = "MUは増収で、AI向けメモリの強さが続いています"
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(model_output(headline=headline)), env=ENV)
        self.assertEqual(saved["headline"], headline)
        self.assertFalse(any(line.startswith("【定型文】") for line in saved["notes"]))

    def test_a_headline_that_drops_the_negation_of_what_it_restates_is_still_rejected(self):
        self.add_note("Micron did not raise its revenue guidance.", ja="会社は売上見通しを引き上げませんでした。")
        evidence = gen.collect(self.db, SATURDAY)
        everything = "\n".join(item["quote"] for item in evidence)
        with self.assertRaises(ValueError) as caught:
            gen._check_framing("MUは売上見通しを引き上げました", evidence, everything)
        self.assertEqual(str(caught.exception), "changed-negation")
        self.assertEqual(gen._check_framing("MUは売上見通しを据え置き、引き上げませんでした", evidence, everything), "MUは売上見通しを据え置き、引き上げませんでした")
        # A clause about something else in the same sentence does not count: profit is not what this headline is about.
        self.assertEqual(gen.negated_scope("MUは増収でした", [{"kind": "analysis", "ticker": "MU", "quote": "MUは増収でしたが、利益は黒字化していません。"}]), "")

    def test_a_wrong_number_in_the_headline_is_still_caught(self):
        self.add_note("Micron did not change its buyback plan.")
        saved = gen.generate(self.db, SATURDAY, transport=FakeModel(model_output(headline="MUは売上高99億ドルで増収")), env=ENV)
        self.assertNotIn("99", saved["headline"])
        self.assertTrue(any(line.startswith("【要確認】見出し") and "unsupported-number" in line for line in saved["notes"]))
        evidence = gen.collect(self.db, SATURDAY)
        with self.assertRaises(ValueError):
            gen._check_framing("MUの売上高は$12.0Bでした", evidence, "\n".join(item["quote"] for item in evidence))

    def test_the_fallback_is_built_from_the_weeks_subjects_and_never_carries_a_figure(self):
        evidence = gen.collect(self.db, SATURDAY)
        self.assertEqual(gen.fallback_headline(evidence, "2026-11-07"), "11/7号：MU決算と米雇用統計")
        cpi = {"kind": "indicator", "ticker": "", "label": "米国CPI（10月）：前年比 3.0%", "quote": "", "facts": [{"key": "cpi-yoy"}]}
        nbis = [{"kind": kind, "ticker": "NBIS", "label": "NBIS", "quote": "", "facts": []} for kind in ("earnings", "analysis")]
        week2 = [{"kind": "earnings", "ticker": "AMAT", "label": "AMAT", "quote": "", "facts": []}, *nbis, cpi]
        self.assertEqual(gen.fallback_headline(week2, "2026-11-14"), "11/14号：NBIS決算と米CPI", "the company with the most material first")
        self.assertEqual(gen.fallback_headline([cpi], "2026-11-14"), "11/14号：米CPI")
        self.assertEqual(gen.fallback_headline([{"kind": "indicator", "ticker": "", "label": "失業率：結果 4.2%", "quote": "", "facts": [{"key": "actual"}]}], ""), "失業率")
        self.assertEqual(gen.fallback_headline([], "2026-11-14"), "11/14号：" + gen.NEUTRAL_HEADLINE)
        self.assertNotEqual(gen.fallback_headline(evidence, "2026-11-07"), gen.fallback_headline(week2, "2026-11-14"))
        for line in (gen.fallback_headline(evidence, "2026-11-07"), gen.fallback_headline(week2, "2026-11-14")):
            self.assertNotRegex(line.split("号：", 1)[1], r"\d", "no figure after the date")


class CostTests(Base):
    """Owner, Nov 15: one model call per draft, the fixed parts first for the prompt cache, deep analyses reused, any configured model."""

    def test_the_fixed_instructions_and_schema_lead_every_request_and_are_the_same_each_week(self):
        first, second = FakeModel(model_output()), FakeModel(model_output())
        gen.generate(self.db, SATURDAY, transport=first, env=ENV)
        publish_flash(self.db, 11, {**MU, "ticker": "AMD", "url": "https://x.com/tipranks/status/11"}, "2026-11-12T21:30:00+00:00"); self.db.commit()
        gen.generate(self.db, SATURDAY + 7 * 86400, transport=second, env=ENV)
        a, b = first.calls[0], second.calls[0]
        self.assertEqual(list(a)[:3], ["model", "instructions", "text"], "fixed parts first, the week's material last")
        self.assertEqual(list(a)[-1], "input")
        self.assertEqual((a["instructions"], a["text"]), (b["instructions"], b["text"]))
        self.assertEqual(a["prompt_cache_key"], gen.PROMPT_CACHE_KEY)
        self.assertEqual(list(json.loads(a["input"]))[-1], "evidence", "the long, changing part is at the very end")

    def test_the_request_is_sent_once_by_the_transport_too(self):
        answer = {"status": "completed", "output_text": json.dumps(model_output(), ensure_ascii=False)}
        with mock.patch.object(gen.brief_generator, "request_response", return_value=answer) as sent:
            gen.generate(self.db, SATURDAY, env=ENV)
        self.assertEqual(sent.call_count, 1)
        self.assertEqual(sent.call_args.kwargs.get("attempts"), 1)

    def test_a_company_with_a_deep_analysis_is_described_by_it_not_by_the_long_note(self):
        self.db.executescript("""DROP TABLE signal_events; CREATE TABLE signal_events(id INTEGER PRIMARY KEY, url TEXT, tickers_json TEXT);
          CREATE TABLE deep_analyses(kind TEXT, subject TEXT, payload TEXT, source_url TEXT, source_title TEXT, state TEXT, published_at TEXT);""")
        self.db.execute("INSERT INTO signal_events(id,url,tickers_json) VALUES(7,'https://example.com/mu',?)", ('["MU"]',))
        self.db.execute("INSERT INTO signal_events(id,url,tickers_json) VALUES(8,'https://example.com/amd',?)", ('["AMD"]',))
        long_ja = "長い公式発表の本文。" * 100
        for event_id, title in ((7, "MUの公式発表"), (8, "AMDの公式発表")):
            payload = {"title": {"ja": title, "en": title}, "summary": {"ja": long_ja, "en": "Long official note."}, "facts": []}
            self.db.execute("INSERT INTO official_research_publications(event_id,sha,body_sha,payload,evidence,started_at,public_at,generation_ms) VALUES(?,'s','b',?,'[]',?,?,0)",
                            (event_id, json.dumps(payload, ensure_ascii=False), "2026-11-06T00:00:00+00:00", "2026-11-06T00:00:00+00:00"))
        analysis = {"headline": {"ja": "MUはHBMが伸びました", "en": "MU HBM grew"}, "points": [{"ja": "HBMの売上が伸びました。", "en": "HBM revenue grew."}]}
        self.db.execute("INSERT INTO deep_analyses VALUES('earnings','MU',?,'https://example.com/mu-ir','MU','done','2026-11-06T01:00:00+00:00')", (json.dumps(analysis, ensure_ascii=False),))
        self.db.commit()
        model = FakeModel(model_output())
        gen.generate(self.db, SATURDAY, transport=model, env=ENV)
        sent = {e["label"]: e for e in json.loads(model.calls[0]["input"])["evidence"]}
        self.assertEqual(sent["MUの公式発表"]["text"], "", "MU's long note is not sent again")
        self.assertEqual(sent["MUの公式発表"]["seeAnalysisOf"], "MU")
        self.assertIn("HBM", next(e["text"] for e in sent.values() if e["type"] == "analysis"))
        self.assertTrue(sent["AMDの公式発表"]["text"], "a company without an analysis keeps its note")
        quotes = [item for item in gen.collect(self.db, SATURDAY) if item["label"] == "MUの公式発表"]
        self.assertTrue(quotes and quotes[0]["quote"], "the note is still evidence the checks read")

    def test_any_configured_model_is_used_as_is(self):
        model = FakeModel(model_output())
        gen.generate(self.db, SATURDAY, transport=model, env={"OPENAI_API_KEY": ENV["OPENAI_API_KEY"], "RESEARCH_DEEP_MODEL": "gpt-5.6-terra"})
        self.assertEqual(model.calls[0]["model"], "gpt-5.6-terra", "no WEEKLY_MODEL: the deep-analysis model is used")
        self.assertEqual(gen.configuration({"OPENAI_API_KEY": ENV["OPENAI_API_KEY"], "RESEARCH_DEEP_MODEL": "gpt-5.6-terra", "WEEKLY_MODEL": "other-1"})[1], "other-1")


class RunTests(Base):
    def test_the_poll_loop_makes_one_draft_a_week(self):
        weekly.save_settings(self.db, {"generateEnabled": True}); self.db.commit()
        model = FakeModel(model_output())
        self.assertEqual(gen.run_if_due(self.path, SATURDAY, transport=model, env=ENV), "done")
        self.assertEqual(gen.run_if_due(self.path, SATURDAY + 4000, transport=model, env=ENV), "idle", "once a week")
        self.assertEqual(len(model.calls), 1)
        with weekly.connect(self.path) as db:
            self.assertEqual(len(weekly.owner_view(db)["drafts"]), 1)
            self.assertEqual(weekly.settings(db)["lastGenerated"], gen.week_key(SATURDAY))

    def test_a_failed_saturday_is_not_tried_again_automatically(self):
        # Owner, Nov 15 (cost): one automatic try a week; after a failure only the owner's button makes another draft.
        weekly.save_settings(self.db, {"generateEnabled": True}); self.db.commit()
        calls = []
        def failing(payload, key):
            calls.append(1); raise RuntimeError("boom")
        self.assertEqual(gen.run_if_due(self.path, SATURDAY, transport=failing, env=ENV), "failed")
        later = FakeModel(model_output())
        for hours in (1, 3, 10):
            self.assertEqual(gen.run_if_due(self.path, SATURDAY + hours * 3600, transport=later, env=ENV), "idle")
        self.assertEqual((len(calls), len(later.calls)), (1, 0))
        self.assertTrue(gen.generate_now(self.path, SATURDAY + 7200, transport=later, env=ENV), "the owner's button still works")
        self.assertEqual(len(later.calls), 1)
        publish_flash(self.db, 12, {**MU, "ticker": "AMD", "url": "https://x.com/tipranks/status/12"}, "2026-11-12T21:30:00+00:00"); self.db.commit()
        self.assertEqual(gen.run_if_due(self.path, SATURDAY + 7 * 86400, transport=later, env=ENV), "done", "next Saturday runs again")

    def test_the_saturday_run_has_no_spending_gate(self):
        # Owner, Nov 15: the issue is always made at the scheduled time; no budget may delay or skip it.
        source = Path(gen.__file__).read_text()
        run = source[source.index("def due("):source.index("# ---- what the week gave us")]
        self.assertNotRegex(run, r"(?i)budget|spend|cost|cap\b")

    def test_when_the_owner_turned_on_automatic_publication_the_draft_is_published_at_once(self):
        weekly.save_settings(self.db, {"generateEnabled": True, "autoPublish": True}); self.db.commit()
        self.assertEqual(gen.run_if_due(self.path, SATURDAY, transport=FakeModel(model_output()), env=ENV), "done")
        with weekly.connect(self.path) as db:
            self.assertEqual(weekly.member_issues(db)["issues"][0]["number"], 1)


if __name__ == "__main__":
    unittest.main()
