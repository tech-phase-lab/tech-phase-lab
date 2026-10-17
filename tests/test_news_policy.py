import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import news_policy
import monitor
import signals

class NewsSelectionTests(unittest.TestCase):
    def test_promotions_are_not_public_news_even_from_official_accounts(self):
        for title in ['Building the agent is only half the challenge. Our free Agentic AI course with @nvidia: sign up here https://t.co/example', 'Join us for a webinar on GPU performance', 'Webinar: quarterly earnings results discussion', 'Nebius is hiring engineers', '無料講座。申し込みはこちら']:
            self.assertFalse(news_policy.eligible(title))
        for title in ['Nebius and NVIDIA announce a new cloud platform', 'Micron Q4 financial results. Register now for the earnings webinar', 'Nebius announces data center expansion']:
            self.assertTrue(news_policy.eligible(title))

    def test_event_invitations_are_not_public_news(self):
        for title in ["Nebius is hosting a private party for our developer community on Oct 16 at Käfer. Don't miss it!",
                      'Join our AMA with the CEO tomorrow', 'See you at our booth at GTC', 'Save the date: Nebius community night',
                      '開発者向けパーティーを開催します。お見逃しなく']:
            self.assertFalse(news_policy.eligible(title), title)
        for title in ["Why we support America's existing nuclear plants", 'Nebius expands its data center in Finland']:
            self.assertTrue(news_policy.eligible(title), title)

    def test_news_headline_removes_cta_and_urls_in_both_languages(self):
        self.assertEqual(news_policy.headline('New GPUs are available. Learn more: https://t.co/example'),'New GPUs are available')
        self.assertEqual(news_policy.headline('新GPUの提供を開始。詳細はこちら：https://t.co/example'),'新GPUの提供を開始')
        self.assertEqual(news_policy.headline('売上$54.23B、EPS$33.42'),'売上$54.23B、EPS$33.42')

    def test_existing_promotion_is_hidden_without_losing_earnings_or_private_evidence(self):
        source=next(s for s in signals.SOURCES if s['id']=='x-nebius-official')
        now=datetime.now(timezone.utc).isoformat()
        with tempfile.TemporaryDirectory() as temp:
            with monitor.connect(Path(temp)/'test.db') as db:
                signals.schema(db)
                items=[{'url':'https://x.com/nebiusai/status/'+str(i), 'title':title,'text':title,'publishedAt':now,'matches':{'NBIS':['Nebius']},'truncated':False} for i,title in [(1,'Our free Agentic AI course with @nvidia. Sign up here: https://t.co/test'),(2,'Nebius quarterly financial results. Learn more: https://t.co/results')]]
                signals.save(db,source,items,{},now,'synthetic',1)
                updates=signals.public_official_updates(db,[source])
                self.assertEqual(len(updates),1)
                self.assertEqual(updates[0]['title'],'Nebius quarterly financial results')
                self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0],2)
