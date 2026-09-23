import unittest
from pathlib import Path
import importlib.util
p=Path(__file__).with_name('meta_ads_rollout.py')
spec=importlib.util.spec_from_file_location('deploy',p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class RolloutTests(unittest.TestCase):
 def test_preserves_all_existing_settings_except_explicit_gates(self):
  source='# comment\nSESSION_SECRET=unchanged\nADMIN_PASSWORD_HASH=unchanged_hash\nMETA_APP_SECRET=kept\nMETA_ADS_WRITES_ENABLED=true\nHAAR_TOOL_BEARER_TOKEN=old\nHAAR_TOOL_ACTOR_ID=owner\n'
  updated=m.locked_environment(source)
  for line in ['# comment','SESSION_SECRET=unchanged','ADMIN_PASSWORD_HASH=unchanged_hash','META_APP_SECRET=kept']:
   self.assertIn(line+'\n',updated)
  self.assertIn('META_ADS_WRITES_ENABLED=false\n',updated)
  self.assertIn('HAAR_TOOL_BEARER_TOKEN=\n',updated)
  self.assertIn('HAAR_TOOL_ACTOR_ID=\n',updated)
  self.assertNotIn('=true',updated)
 def test_exported_duplicate_gate_values_are_all_closed(self):
  updated=m.locked_environment('export META_ADS_WRITES_ENABLED=true\n META_ADS_WRITES_ENABLED = true\nHAAR_TOOL_BEARER_TOKEN=bad\nHAAR_TOOL_BEARER_TOKEN=again\n')
  self.assertNotIn('true',updated)
  self.assertNotIn('=bad',updated)
  self.assertNotIn('=again',updated)
 def test_health_fails_closed(self):
  good={'status':'ok','database':'ok','version':'0.2.0','features':{'metaAds':True,'adsExecutionEnabled':False}}
  self.assertTrue(m.release_healthy(good))
  for changed in [{'features':{'metaAds':True,'adsExecutionEnabled':True}},{'version':'0.1.0'},{'status':'degraded'},{'database':'unavailable'},{'features':{'metaAds':True}}]:
   self.assertFalse(m.release_healthy({**good,**changed}))
 def test_existing_asset_counts_may_grow_but_not_shrink(self):
  before={'ownerSignature':'private-a','connectionSignature':'private-b','products':2,'media':3,'posts':4}
  self.assertTrue(m.data_preserved(before,{**before,'posts':5}))
  self.assertFalse(m.data_preserved(before,{**before,'media':2}))
  self.assertFalse(m.data_preserved(before,{**before,'ownerSignature':'changed'}))
if __name__=='__main__': unittest.main()
