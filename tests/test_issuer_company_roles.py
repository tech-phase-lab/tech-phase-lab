"""Company relevance is not established by a platform or hardware brand."""
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import issuer_business_news as news

class CompanyRoleTests(unittest.TestCase):
    def role(self,issuer,ticker,title,body):
        return news.company_role({'title':title},{'issuer':issuer},ticker,body)
    def test_third_party_google_ads_tool_is_incidental(self):
        self.assertIsNone(self.role('Multiply','GOOGL','Multiply Launches Ad Spend Recovery Agent to Eliminate $126K in Average Annual Google Ads Waste',
          'Multiply announced its Ad Spend Recovery Agent. The agent runs on Google Ads data. An analysis of prospect data found average wasted advertising spend.'))
    def test_gpu_buyer_is_not_an_announced_nvidia_counterparty(self):
        self.assertIsNone(self.role('La Rosa Holdings Corp.','NVDA','La Rosa Holdings Acquires Next-Generation NVIDIA GPUs, Advancing AI Infrastructure Strategy',
          'La Rosa acquired NVIDIA B300 GPUs and leased those assets back under a long-term lease expected to generate recurring cash flows.'))
    def test_aib_nebius_explicit_contract_remains_material(self):
        self.assertEqual(self.role('AIB Data Centers Inc.','NBIS','AIB Data Centers Signs Contract with Nebius for AI Data Center Capacity',
          'AIB entered into a binding agreement with Nebius for AI data center capacity.'),'explicit-contract-counterparty')
    def test_monitored_issuer_and_company_acquisition_remain_material(self):
        self.assertEqual(self.role('Oracle Corporation','ORCL','Oracle Announces Commitment for Energy Costs','Oracle announced its commitment.'),'monitored-issuer')
        self.assertEqual(self.role('Example Holdings Inc.','MU','Example Acquires Micron for Cash','Example acquired Micron for cash.'),'explicit-acquisition-subject')
    def test_no_counterparty_from_headline_alone_or_substring_issuer(self):
        self.assertIsNone(self.role('Third Party Inc.','GOOGL','Third Party Announces Partnership with Google','The new tool operates using Google Ads data.'))
        self.assertIsNone(self.role('Google Analytics Consulting LLC','GOOGL','Google Analytics Consulting Launches a Tool','A consulting company announced its tool.'))

if __name__=='__main__':unittest.main()
