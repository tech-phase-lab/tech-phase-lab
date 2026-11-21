"""Nov 17 (owner): おやすみモード hours are kept per device in Japan time or US Eastern Time. The English site saves ET, the
Japanese site Japan time; the monitor reads the hours in the stored zone with real zone rules, so daylight saving time is right."""
import hashlib
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push
from test_web_push import subscription

NY = ZoneInfo('America/New_York')
TOKYO = ZoneInfo('Asia/Tokyo')
UTC = ZoneInfo('UTC')


def utc(year, month, day, hour, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=UTC).timestamp()


class Base(unittest.TestCase):
    language = 'ja'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'p.sqlite'
        self.db = push.connect(self.path)
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'f', 'WEB_PUSH_PUBLIC_KEY': 'f', 'WEB_PUSH_SUBJECT': 'mailto:f@example.test'})
        self.env.start()
        self.now = utc(2026, 11, 17, 3)
        self.payload = {'memberId': 'user_fixture', 'subscription': subscription(), 'accessExpiresAt': self.now + 3600, 'allTargets': True, 'language': self.language}
        push.register_member(self.db, self.payload, {'MU'}, self.now - 10)

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def prefs(self):
        return push.member_preferences(self.db, self.payload, now=self.now)['preferences']

    def save(self, prefs):
        return push.member_preferences(self.db, {**self.payload, 'preferences': prefs}, save=True, now=self.now)['preferences']

    def device(self):
        return self.db.execute('SELECT * FROM push_devices').fetchone()


class Defaults(Base):
    def test_a_device_turned_on_from_the_japanese_site_starts_at_23_to_7_japan_time(self):
        self.assertEqual(self.prefs()['quiet'], {'on': True, 'start': 23, 'end': 7, 'zone': 'Asia/Tokyo'})

    def test_a_device_turned_on_from_the_english_site_starts_at_23_to_7_eastern_time(self):
        push.register_member(self.db, {**self.payload, 'subscription': subscription('updates.push.services.mozilla.com'), 'language': 'en'}, {'MU'}, self.now)
        row = self.db.execute('SELECT * FROM push_devices WHERE language=?', ('en',)).fetchone()
        self.assertEqual(push.preference_view(self.db, row)['quiet'], {'on': True, 'start': 23, 'end': 7, 'zone': 'America/New_York'})

    def test_registering_again_in_the_other_language_keeps_the_stored_zone(self):
        push.register_member(self.db, {**self.payload, 'language': 'en'}, {'MU'}, self.now)
        self.assertEqual(self.device()['language'], 'en')
        self.assertEqual(self.prefs()['quiet']['zone'], 'Asia/Tokyo')

    def test_the_legacy_register_also_starts_in_the_sites_zone(self):
        push.register(self.db, {'subscription': subscription('web.push.apple.com'), 'tickers': ['MU'], 'language': 'en'}, {'MU'}, self.now)
        row = self.db.execute('SELECT quiet_zone FROM push_devices WHERE language=?', ('en',)).fetchone()
        self.assertEqual(row['quiet_zone'], 'America/New_York')


class Migration(unittest.TestCase):
    def test_existing_devices_keep_japan_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'old.sqlite'
            old = sqlite3.connect(path)
            old.executescript('''CREATE TABLE push_devices (id TEXT PRIMARY KEY, subscription TEXT NOT NULL, tickers TEXT NOT NULL,
              language TEXT NOT NULL, since REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
              INSERT INTO push_devices VALUES ('d1', '{}', '["*"]', 'en', 0, 1);''')
            old.commit(); old.close()
            db = push.connect(path)
            try:
                row = db.execute('SELECT * FROM push_devices').fetchone()
                self.assertEqual(row['quiet_zone'], 'Asia/Tokyo', 'an English device saved before Nov 17 keeps the Japan-time hours it chose')
                self.assertEqual((row['quiet_start'], row['quiet_end']), (23, 7))
                self.assertTrue(push.in_quiet_hours(row, datetime(2026, 11, 17, 23, 30, tzinfo=TOKYO).timestamp()))
            finally:
                db.close()


class Validation(Base):
    def test_zone_round_trip_and_bad_zones(self):
        saved = self.save({'quiet': {'on': True, 'start': 22, 'end': 6, 'zone': 'America/New_York'}})
        self.assertEqual(saved['quiet'], {'on': True, 'start': 22, 'end': 6, 'zone': 'America/New_York'})
        self.assertEqual(self.prefs()['quiet'], saved['quiet'])
        self.assertEqual(self.device()['quiet_zone'], 'America/New_York')
        self.assertEqual(self.save({'targets': False})['quiet']['zone'], 'America/New_York', 'saving another switch keeps the zone')
        for zone in ('Europe/London', 'UTC', '', None, 9, 'asia/tokyo'):
            with self.assertRaises(ValueError, msg=zone):
                self.save({'quiet': {'on': True, 'start': 23, 'end': 7, 'zone': zone}})
        with self.assertRaises(ValueError):
            self.save({'quiet': {'on': True, 'start': 23, 'end': 7, 'zone': 'Asia/Tokyo', 'extra': 1}})

    def test_hours_sent_without_a_zone_are_japan_time(self):
        self.save({'quiet': {'on': True, 'start': 22, 'end': 6, 'zone': 'America/New_York'}})
        saved = self.save({'quiet': {'on': True, 'start': 23, 'end': 7}})
        self.assertEqual(saved['quiet'], {'on': True, 'start': 23, 'end': 7, 'zone': 'Asia/Tokyo'})
        self.assertEqual(push.validate_preferences({'quiet': {'on': False, 'start': 1, 'end': 2}})['quiet']['zone'], 'Asia/Tokyo')

    def test_an_unknown_stored_zone_reads_as_japan_time(self):
        with self.db:
            self.db.execute("UPDATE push_devices SET quiet_zone='Mars/Base'")
        self.assertEqual(self.prefs()['quiet']['zone'], 'Asia/Tokyo')


class QuietHours(Base):
    def blocks(self, moment, start=23, end=7, zone='America/New_York', on=True):
        self.save({'quiet': {'on': on, 'start': start, 'end': end, 'zone': zone}})
        return push.in_quiet_hours(self.device(), moment)

    def test_japan_time_hours(self):
        self.assertTrue(self.blocks(datetime(2026, 11, 17, 23, 30, tzinfo=TOKYO).timestamp(), zone='Asia/Tokyo'))
        self.assertTrue(self.blocks(datetime(2026, 11, 18, 6, 59, tzinfo=TOKYO).timestamp(), zone='Asia/Tokyo'))
        self.assertFalse(self.blocks(datetime(2026, 11, 18, 7, 0, tzinfo=TOKYO).timestamp(), zone='Asia/Tokyo'))
        # 23:30 in New York is 13:30 the next day in Tokyo: awake in Japan time.
        self.assertFalse(self.blocks(datetime(2026, 11, 17, 23, 30, tzinfo=NY).timestamp(), zone='Asia/Tokyo'))

    def test_eastern_time_hours(self):
        self.assertTrue(self.blocks(datetime(2026, 11, 17, 23, 30, tzinfo=NY).timestamp()))
        self.assertTrue(self.blocks(datetime(2026, 11, 18, 3, 0, tzinfo=NY).timestamp()))
        self.assertFalse(self.blocks(datetime(2026, 11, 18, 7, 0, tzinfo=NY).timestamp()))
        self.assertFalse(self.blocks(datetime(2026, 11, 17, 22, 59, tzinfo=NY).timestamp()))
        self.assertFalse(self.blocks(datetime(2026, 11, 17, 23, 30, tzinfo=TOKYO).timestamp()), '23:30 in Tokyo is 09:30 in New York')
        self.assertFalse(self.blocks(datetime(2026, 11, 18, 3, 0, tzinfo=NY).timestamp(), on=False))

    def test_daylight_saving_time_ends_nov_1_2026(self):
        # Before the switch (EDT, UTC-4): 03:30 UTC on Nov 1 is 23:30 on Oct 31 in New York.
        self.assertTrue(self.blocks(utc(2026, 11, 1, 3, 30)))
        self.assertFalse(self.blocks(utc(2026, 10, 31, 2, 30)), '22:30 EDT')
        # After the switch (EST, UTC-5): 03:30 UTC on Nov 2 is 22:30 on Nov 1, still awake; a fixed UTC-4 would say 23:30.
        self.assertFalse(self.blocks(utc(2026, 11, 2, 3, 30)))
        self.assertTrue(self.blocks(utc(2026, 11, 2, 4, 30)), '23:30 EST')
        # 11:30 UTC on Nov 2 is 06:30 EST, still asleep; a fixed UTC-4 would say 07:30.
        self.assertTrue(self.blocks(utc(2026, 11, 2, 11, 30)))
        self.assertFalse(self.blocks(utc(2026, 11, 2, 12, 0)), '07:00 EST')

    def test_daylight_saving_time_starts_mar_8_2026(self):
        # Before (EST, UTC-5): 11:30 UTC on Mar 7 is 06:30 in New York, asleep.
        self.assertTrue(self.blocks(utc(2026, 3, 7, 11, 30)))
        # After (EDT, UTC-4): 11:30 UTC on Mar 9 is 07:30, awake; a fixed UTC-5 would say 06:30.
        self.assertFalse(self.blocks(utc(2026, 3, 9, 11, 30)))
        self.assertTrue(self.blocks(utc(2026, 3, 9, 10, 30)), '06:30 EDT')
        self.assertTrue(self.blocks(utc(2026, 3, 9, 3, 30)), '23:30 EDT on Mar 8')
        self.assertFalse(self.blocks(utc(2026, 3, 9, 2, 30)), '22:30 EDT on Mar 8')

    def test_any_moment_asleep_blocks(self):
        self.save({'quiet': {'on': True, 'start': 23, 'end': 7, 'zone': 'America/New_York'}})
        day = datetime(2026, 11, 17, 12, tzinfo=NY).timestamp()
        night = datetime(2026, 11, 17, 2, tzinfo=NY).timestamp()
        self.assertTrue(push.in_quiet_hours(self.device(), day, night))
        self.assertFalse(push.in_quiet_hours(self.device(), day))

    def test_a_plain_dict_device_without_a_zone_is_japan_time(self):
        device = {'quiet_on': 1, 'quiet_start': 23, 'quiet_end': 7}
        self.assertTrue(push.in_quiet_hours(device, datetime(2026, 11, 17, 23, 30, tzinfo=TOKYO).timestamp()))
        self.assertFalse(push.in_quiet_hours(device, datetime(2026, 11, 17, 23, 30, tzinfo=NY).timestamp()))


class EnglishDevice(Base):
    language = 'en'

    def test_new_english_device_defaults_and_eastern_blocking(self):
        self.assertEqual(self.prefs()['quiet'], {'on': True, 'start': 23, 'end': 7, 'zone': 'America/New_York'})
        self.assertTrue(push.in_quiet_hours(self.device(), datetime(2026, 11, 17, 23, 30, tzinfo=NY).timestamp()))
        self.assertFalse(push.in_quiet_hours(self.device(), datetime(2026, 11, 17, 23, 30, tzinfo=TOKYO).timestamp()))
        self.assertEqual(hashlib.sha256(subscription()['endpoint'].encode()).hexdigest(), self.device()['id'])


if __name__ == '__main__':
    unittest.main()
