import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import favorite_lists as favorites

class FavoriteListsTests(unittest.TestCase):
    def test_private_roundtrip_conflict_and_deletion(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'favorites.sqlite')
            first = {'lists':[{'id':'default','name':'保有株','tickers':['MU']}], 'names':{'MU':'Micron'}, 'alerts':[{'ticker':'MU','price':500,'direction':'above','currency':'USD'}]}
            with favorites.connect(path) as db:
                self.assertEqual(favorites.read(db,'a'*64)['revision'],0)
                self.assertEqual(favorites.save(db,'a'*64,0,first)['revision'],1)
                self.assertIsNone(favorites.read(db,'b'*64)['document'])
            with favorites.connect(path) as db:
                self.assertEqual(favorites.read(db,'a'*64)['document'],first)
                other = {**first, 'lists':[{'id':'default','name':'other','tickers':[]}]}
                self.assertTrue(favorites.save(db,'a'*64,0,other)['conflict'])
                self.assertEqual(favorites.read(db,'a'*64)['document'],first)
                self.assertEqual(favorites.save(db,'a'*64,1,other)['revision'],2)
                self.assertEqual(favorites.read(db,'a'*64)['document']['lists'][0]['tickers'],[])
    def test_validation(self):
        base = {'lists':[{'id':'default','name':'','tickers':['MU']}], 'names':{}}
        for invalid in [{**base,'alerts':[{'ticker':'MU','price':float('nan'),'direction':'above','currency':'USD'}]}, {**base,'lists':base['lists']*2}, {**base,'names':{'MU': 'x'*161}}]:
            with self.assertRaises(ValueError): favorites.validate(invalid)
        with self.assertRaises(ValueError): favorites.owner_key('another-user')
