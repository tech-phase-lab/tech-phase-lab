from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import factual_validation as validation


def check(ja, en):
    validation.validate_numbers(ja, en)
    validation.validate_semantics(ja, en)
    validation.validate_names(ja, en)


class MeaningValidationTests(unittest.TestCase):
    REVERSED = (
        ('Micron revenue rose 10% in fiscal Q4', 'マイクロン、第4四半期売上高が10%減', 'changed-direction'),
        ('Micron raises full-year guidance', 'マイクロン、通期見通しを引き下げ', 'changed-direction'),
        ('Nvidia beats revenue estimates', 'エヌビディア、売上高が予想を下回る', 'changed-direction'),
        ('Analyst upgrades AMD to Buy', 'アナリストがAMDを格下げ', 'changed-direction'),
        ('Revenue rose 12% while gross margin declined', '売上高は12%減少、粗利益率は上昇', 'changed-metric-direction'),
        ('Broadcom does not expect delays to shipments', 'ブロードコム、出荷遅延を見込む', 'changed-negation'),
        ('TSMC swings to net profit', 'TSMC、赤字に転落', 'changed-direction'),
        ('Vertiv shares jump 8% after earnings', 'バーティブ株、決算後に8%急落', 'changed-direction'),
        ('Company reports narrower loss', '同社、損失が拡大', 'changed-direction'),
        ('Oracle wins $10B contract', 'オラクル、100億ドルの契約を失う', 'changed-direction'),
        ('$NVDA added to index', '$AMDが指数に採用', 'changed-names'),
        ('Dell names Jane Smith CFO', 'デル、John DoeをCFOに任命', 'changed-names'),
    )
    FAITHFUL = (
        ('Micron revenue rose 10% in fiscal Q4', 'マイクロン、第4四半期売上高が10%増'),
        ('Micron raises full-year guidance', 'マイクロン、通期見通しを引き上げ'),
        ('Nvidia beats revenue estimates', 'エヌビディア、売上高が予想を上回る'),
        ('Analyst upgrades AMD to Buy', 'アナリストがAMDを「買い」に格上げ'),
        ('Revenue rose 12% while gross margin declined', '売上高は12%増加、一方で粗利益率は低下'),
        ('Broadcom does not expect delays to shipments', 'ブロードコム、出荷の遅延は見込まず'),
        ('TSMC swings to net profit', 'TSMC、黒字に転換'),
        ('Company reports narrower loss', '同社、損失が縮小'),
        ('Microsoft expands partnership with OpenAI', 'マイクロソフト、OpenAIとの提携を拡大'),
        ('NVIDIA GeForce NOW adds 10 games this fall', 'NVIDIA GeForce NOW、今秋10本のゲームを追加'),
        ('Fed holds rates steady, signals cuts later', 'FRB、金利を据え置き　後の利下げを示唆'),
        ('Dell to acquire startup for $2B', 'デル、スタートアップを20億ドルで買収する計画'),
    )

    def test_reversed_translations_are_rejected(self):
        for en, ja, code in self.REVERSED:
            with self.subTest(en=en):
                with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                    check(ja, en)

    def test_faithful_translations_pass(self):
        for en, ja in self.FAITHFUL:
            with self.subTest(en=en):
                check(ja, en)

    def test_pair_check_rejects_reversed_bilingual_copy(self):
        with self.assertRaisesRegex(ValueError, 'changed-'):
            validation.validate_pair('マイクロン、見通しを引き下げ', 'Micron raises its outlook')
        validation.validate_pair('マイクロン、見通しを引き上げ', 'Micron raises its outlook')

    def test_whether_or_not_is_not_a_negation(self):
        validation.validate_negation('採用するかどうかを検討', 'Company weighs whether or not to adopt the chip')

    def test_summary_may_leave_out_a_negated_side_clause(self):
        source = 'Brent crude rises 2% as OPEC+ says it will not raise output'
        validation.validate_negation('ブレント原油が2%上昇', source)
        validation.validate_negation('Brent crude rises 2%', source)
        validation.validate_negation('米10年債利回りが再び急上昇',
                                     'U.S. 10-Year Treasury Yield rising sharply again. Not seen since 2007.')

    def test_issuer_table_dates_written_day_month_year_support_the_matching_japanese_dates(self):
        # Oct 12: ASML's buyback tables write "5-Oct-26"; a correct title naming 10月5日〜10月9日 was rejected.
        source = ('ASML reports the following transactions, conducted under its current share buyback program.\n'
                  'Date Total repurchased shares Weighted average price\n'
                  '5-Oct-26 60,000 \u20ac1,653.55\n9-Oct-26 50,000 \u20ac1,616.48')
        validation.validate_numbers('ASML、10月5日〜10月9日の自社株買い取引を報告', source)
        for wrong in ('ASML、11月5日〜11月9日の自社株買い取引を報告',
                      'ASML、10月6日〜10月12日の自社株買い取引を報告',
                      'ASML、10月5日〜10月9日に1億ユーロの買い戻し'):
            with self.assertRaisesRegex(ValueError, '^unsupported-number$'):
                validation.validate_numbers(wrong, source)

    def test_spelled_channel_counts_and_generation_ordinals_support_the_japanese_digits(self):
        # Oct 12: Marvell's "Second-generation ... Six-channel" title was rejected for 第2世代 and 6チャネル.
        title = 'Marvell Unveils Second-generation Structera X, Industry-first Six-channel CXL 3.2 Memory Expanders for AI Inference'
        validation.validate_numbers('Marvell、第2世代Structera Xと業界初の6チャネルCXL 3.2メモリ拡張を発表', title)
        for wrong in ('Marvell、第3世代Structera Xと業界初の6チャネルCXL 3.2メモリ拡張を発表',
                      'Marvell、第2世代Structera Xと業界初の8チャネルCXL 3.2メモリ拡張を発表',
                      'Marvell、第2世代Structera Xと業界初の6チャネルCXL 3.3メモリ拡張を発表'):
            with self.assertRaisesRegex(ValueError, '^unsupported-number$'):
                validation.validate_numbers(wrong, title)

    def test_short_negated_aside_in_the_quote_does_not_reject_a_title_that_never_repeats_it(self):
        # Oct 12: an NVIDIA release was held for days because the quoted paragraph held
        # "not today, not tomorrow" and the English title was read as restating it.
        quote = ('\u201cThe thing that I really give Jensen all the credit for, quite frankly, is that consistency '
                 'of vision of what this can be\u2014not today, not tomorrow, but as a secular trend,\u201d Nadella said.')
        validation.validate_negation('NVIDIA, Microsoft Kick Off a New Beginning for Windows PCs with RTX Spark and AI Agents', quote)
        validation.validate_negation('NVIDIAとMicrosoft、Windows PCの新たな幕開けを開始', quote)
        # The same one-word clause is still enforced when the copy repeats its word.
        with self.assertRaisesRegex(ValueError, '^changed-negation$'):
            validation.validate_negation('Rain expected today', 'Not today.')

    def test_summary_that_restates_a_negated_clause_keeps_the_negation(self):
        source = 'Brent crude rises 2% as OPEC+ says it will not raise output'
        with self.assertRaisesRegex(ValueError, '^changed-negation$'):
            validation.validate_negation('OPEC+ says it will raise output', source)
        with self.assertRaisesRegex(ValueError, '^changed-negation$'):
            validation.validate_negation('OPEC+が増産すると表明', 'OPEC+ says it will not raise output')
        validation.validate_negation('OPEC+ will not raise output', source)

    def test_names_spaced_differently_are_the_same_name(self):
        validation.validate_names('S&P500に採用', 'Added to the S&P 500 index')
        # Japanese drops English plurals.
        validation.validate_names('Windows PCの新時代', 'A New Beginning for Windows PCs')
        with self.assertRaisesRegex(ValueError, '^changed-names$'):
            validation.validate_names('S&P500に採用', 'Added to the index')
        with self.assertRaisesRegex(ValueError, '^changed-names$'):
            validation.validate_names('Armが上昇', 'Pharma stocks rise')

    def test_x_handles_hashtags_and_cashtags_may_be_kept_or_written_out(self):
        # Nov 20: an X post naming a company only by its handle (@ChefRobotics) was rejected five times because the translation
        # wrote the name out ("Chef Robotics"), and the post never got a Japanese headline.
        post = 'Training robots at scale with @ChefRobotics on Nebius AI Cloud #NebiusAI $NBIS'
        for copy in ('Chef Robotics、ネビウスのAIクラウドでロボット学習を拡大',
                     '@ChefRobotics、Nebius AI Cloudでロボット学習を拡大',
                     'ChefRobotics、ネビウスのAIクラウドでロボット学習を拡大 #NebiusAI $NBIS',
                     'Chef Robotics、NBISのAIクラウドで学習を拡大'):
            with self.subTest(copy=copy):
                validation.validate_names(copy, post)
        validation.validate_names('Nebius AIの新機能を公開', 'New from @nebiusai today')  # a lowercase handle written out
        validation.validate_names('Token Factoryを提供開始', 'Now live: #TokenFactory')
        validation.validate_names('エヌビディアが指数に採用', '$NVDA added to index')  # a cashtag written as the Japanese name
        validation.validate_names('$NBISが上昇', '$NBIS rises')  # a cashtag followed by Japanese is still a cashtag
        # Still rejected: a name the post does not have, an added cashtag, a dropped cashtag with no name for it.
        for copy, english, name in (('Chef Robotics、AIを拡大', 'Training robots with @nebiusai', 'chef'),
                                    ('$AMDが指数に採用', '$NVDA added to index', '$AMD'),
                                    ('指数に採用', '$NVDA added to index', '$NVDA'),
                                    ('Chef Robotics Labsが参加', 'Welcome @ChefRobotics', 'labs')):
            with self.subTest(copy=copy):
                with self.assertRaisesRegex(ValueError, '^changed-names$'):
                    validation.validate_names(copy, english)
                self.assertEqual(validation.LAST_NAME_REJECTION[0], name)

    def test_a_cached_rejection_reports_its_own_detail(self):
        # The checks are cached for the public feed; a repeated rejection must not report the name of an earlier, different one.
        for _ in range(2):
            for copy, english, name in (('Zorvexが発表', 'Acme announced', 'zorvex'), ('Qwertyが発表', 'Acme announced', 'qwerty')):
                with self.assertRaisesRegex(ValueError, '^changed-names$'):
                    validation.validate_names(copy, english)
                self.assertEqual(validation.LAST_NAME_REJECTION[0], name)

    def test_program_names_and_properties_are_not_directions(self):
        # Sentences of the GOOGL "Small businesses, big results" release (Nov 19): none of them says anything rose or fell.
        for sentence in ('Constantly jumping between the flavor lab, marketing, and operations, team members use Gemini in Google Docs.',
                         'Grow with Google AI training: Access Grow with Google resources that will help you reach more customers.',
                         'The Gemini app is now available on lower-memory Android devices.'):
            with self.subTest(sentence=sentence):
                self.assertEqual(validation.directions(sentence, validation.DIRECTION_FAMILIES[0]), set())
        validation.validate_directions('チームがGeminiで手作業の時間を削減', 'Constantly jumping between the flavor lab, marketing, '
                                       'and operations, team members use Gemini in Google Docs to brainstorm campaigns.')
        # Real directions are unchanged.
        for copy, source in (('売上が減少', 'Revenue rose 5%'), ('株価が上昇', 'Shares fell 5%'), ('作業時間が増加', 'cut hours of manual work')):
            with self.subTest(copy=copy):
                with self.assertRaisesRegex(ValueError, '^changed-direction$'):
                    validation.validate_directions(copy, source)
        self.assertEqual(validation.directions('higher-than-expected revenue', validation.DIRECTION_FAMILIES[0]), {'up'})

    def test_every_lane_recognizes_the_new_failure_codes(self):
        import general_source_news, headline_translation, x_market_news
        for code in validation.MEANING_FAILURES:
            self.assertIn(code, headline_translation.VALIDATION_FAILURES)
            self.assertIn(code, x_market_news.FAILURES)
            self.assertIn(code, general_source_news.FAILURE_CODES)


if __name__ == '__main__':
    unittest.main()


class GlossaryNameTests(unittest.TestCase):
    """Owner, Nov 26: "GE HealthCare advances total body PET/CT" was translated as 「GEベルノバ、…」."""

    def test_a_listed_spelling_needs_the_company_in_the_english(self):
        with self.assertRaisesRegex(ValueError, 'changed-names'):
            validation.validate_names('GEベルノバ、全身用PET/CTのOmni 128cmを進展', 'GE HealthCare advances total body PET/CT innovation with Omni 128 cm')
        with self.assertRaisesRegex(ValueError, 'changed-names'):
            validation.validate_names('エヌビディアが新製品', 'Acme launches a new product')

    def test_the_company_its_ticker_or_an_alias_is_enough(self):
        for ja, en in (('GEベルノバ、受注を拡大', 'GE Vernova expands orders'), ('エヌビディア株が上昇', 'NVDA stock rises'),
                       ('エヌビディア、新ラックを出荷', "Nvidia's new rack ships"), ('TSMC、2nm量産を開始', 'Taiwan Semiconductor starts 2nm production'),
                       ('アルファベット傘下のグーグル', 'Google, an Alphabet unit'), ('新モデルを発表', 'Acme unveils a new model'),
                       ('ロボットアームの新製品', 'A new robot arm product')):
            validation.validate_names(ja, en)
