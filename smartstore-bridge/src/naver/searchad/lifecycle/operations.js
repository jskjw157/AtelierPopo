export const KEYWORD_CREATE_MAX_BATCH = 100;

function frozenOperations(create, read, remove) {
  return Object.freeze({ create, read, delete: remove });
}

export const SEARCHAD_HIERARCHY_OPERATIONS = Object.freeze({
  campaign: frozenOperations(
    'ncc.post.add_using_post_3__p_ncc_campaigns',
    'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',
    'ncc.delete.remove_using_delete_5__p_ncc_campaigns_campaign_id'
  ),
  adgroup: frozenOperations(
    'ncc.post.add_using_post_6__p_ncc_adgroups',
    'ncc.get.get_using_get_16__p_ncc_adgroups_adgroup_id',
    'ncc.delete.remove_using_delete_7__p_ncc_adgroups_adgroup_id'
  ),
  keyword: frozenOperations(
    'ncc.post.add_using_post_4__p_ncc_keywords__q_ncc_adgroup_id',
    'ncc.get.get_using_get_14__p_ncc_keywords_ncc_keyword_id',
    'ncc.delete.remove_using_delete_6__p_ncc_keywords_ncc_keyword_id'
  ),
  creative: frozenOperations(
    'ncc.post.add_using_post_1__p_ncc_ads',
    'ncc.get.get_using_get_10__p_ncc_ads_ad_id',
    'ncc.delete.remove_using_delete__p_ncc_ads_ad_id'
  )
});

export const SEARCHAD_LIFECYCLE_KINDS = Object.freeze(['create', 'batch_create', 'delete']);
