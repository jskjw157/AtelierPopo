BEGIN;

-- 하나의 판매 채널을 사업상 역할과 기술 플랫폼으로 분리한다.
-- HAAR 자사몰은 channel_role=owned_store, platform_type=cafe24인 단일 채널이다.
ALTER TABLE sales_channels
  ADD COLUMN IF NOT EXISTS channel_role text,
  ADD COLUMN IF NOT EXISTS platform_type text,
  ADD COLUMN IF NOT EXISTS external_store_id text,
  ADD COLUMN IF NOT EXISTS primary_domain text;

-- 기존 channel_type 값은 하위 호환을 위해 유지한다.
-- 신규 코드에서는 channel_role을 우선 사용하고 channel_type은 legacy alias로 읽는다.
UPDATE sales_channels
SET channel_role = COALESCE(
  channel_role,
  CASE
    WHEN lower(channel_type) IN ('own_site', 'owned_store', 'cafe24') THEN 'owned_store'
    WHEN lower(channel_type) IN ('naver_smartstore', 'marketplace') THEN 'marketplace'
    ELSE 'other'
  END
)
WHERE channel_role IS NULL;

UPDATE sales_channels
SET platform_type = COALESCE(
  platform_type,
  CASE
    WHEN lower(channel_type) IN ('own_site', 'owned_store', 'cafe24') THEN 'cafe24'
    WHEN lower(channel_type) IN ('naver_smartstore', 'marketplace') THEN 'naver_smartstore'
    ELSE channel_type
  END
)
WHERE platform_type IS NULL;

ALTER TABLE sales_channels
  ALTER COLUMN channel_role SET NOT NULL,
  ALTER COLUMN platform_type SET NOT NULL;

ALTER TABLE sales_channels
  DROP CONSTRAINT IF EXISTS sales_channels_channel_role_check;

ALTER TABLE sales_channels
  ADD CONSTRAINT sales_channels_channel_role_check
  CHECK (channel_role IN (
    'marketplace',
    'owned_store',
    'social_commerce',
    'wholesale',
    'other'
  ));

-- 같은 플랫폼의 같은 외부 스토어를 중복 등록하지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS sales_channels_platform_store_uidx
  ON sales_channels (platform_type, external_store_id)
  WHERE external_store_id IS NOT NULL;

-- 같은 대표 도메인을 두 판매 채널로 중복 등록하지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS sales_channels_primary_domain_uidx
  ON sales_channels (lower(primary_domain))
  WHERE primary_domain IS NOT NULL;

COMMENT ON COLUMN sales_channels.channel_role IS
  '판매 채널의 사업상 역할. 예: marketplace, owned_store';

COMMENT ON COLUMN sales_channels.platform_type IS
  '판매 채널을 운영하는 플랫폼. 예: naver_smartstore, cafe24';

COMMENT ON COLUMN sales_channels.external_store_id IS
  '플랫폼 내부 스토어 식별자. Cafe24 mall_id 또는 네이버 판매자/채널 식별자';

COMMENT ON COLUMN sales_channels.primary_domain IS
  '스토어의 대표 도메인. HAAR 자사몰은 haar.co.kr';

-- 중복 데이터가 이미 존재한 경우 자동 삭제·병합하지 않는다.
-- 운영 Migration 전 아래 후보를 조회하고 HAAR 상품·주문 참조를 하나의 channel_id로 병합해야 한다.
--
-- SELECT channel_id, channel_type, channel_role, platform_type, primary_domain
-- FROM sales_channels
-- WHERE lower(channel_type) IN ('cafe24', 'own_site', 'owned_store')
--    OR lower(platform_type) = 'cafe24'
--    OR lower(primary_domain) = 'haar.co.kr';

COMMIT;
