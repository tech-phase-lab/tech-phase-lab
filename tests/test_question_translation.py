import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import questions
import question_translation

class QuestionTranslationTests(unittest.TestCase):
    def test_translation_backfills_board_only_and_keeps_identity_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'q.db')
            with questions.connect(path) as db:
                questions.submit(db, {'ownerKey':'a'*64,'body':'PRO版に投稿しました。','audience':'pro-board'})
                questions.submit(db, {'ownerKey':'b'*64,'body':'これは非公開の質問です。','audience':'private'})
            env = {'NOTE_TRANSLATION_ENABLED':'true','OPENAI_API_KEY':'synthetic-test-key-only-1234','NOTE_TRANSLATION_MODEL':'gpt-4.1-mini','NOTE_TRANSLATION_DAILY_LIMIT':'1'}
            calls=[]
            def transport(payload,key):
                calls.append(payload)
                return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'bodyEn':'I posted in PRO.'})}]}]}
            self.assertEqual(question_translation.run_once(path,transport,env,1000),'done')
            self.assertNotIn('ownerKey', json.dumps(calls))
            with questions.connect(path) as db:
                board=questions.board_queue(db,'a'*64)
                self.assertEqual(board['items'][0]['bodyEn'],'I posted in PRO.')
                private=questions.member_queue(db,'b'*64)
                self.assertEqual(private['items'][0]['bodyEn'],'')
            self.assertEqual(question_translation.run_once(path,transport,env,1001),'idle')
            self.assertEqual(len(calls),1)

    def test_disabled_without_configuration(self):
        self.assertEqual(question_translation.run_once('unused',env={}), 'disabled')
