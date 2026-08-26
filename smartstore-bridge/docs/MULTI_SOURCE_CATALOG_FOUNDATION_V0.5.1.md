# HAAR Multi-source Catalog Foundation v0.5.1

## Purpose

This milestone converts the existing QueenSilver-only catalog runtime into a source registry that can host multiple suppliers and product ingestion methods.

QueenSilver remains the first working adapter because its Drive manifest is already available, but its product number is not used as the platform-wide product identity.

## Identity layers

```text
Source product
(source_id, source_product_id)

HAAR product
haar_product_id

Channel product
(channel_id, channel_product_no)

SearchAd object
(customer_id, remote_entity_id)
```

v0.5.1 implements the first layer at runtime and preserves the PostgreSQL schema for all layers.

## Working provider

```text
provider_type: google_drive_manifest
implementation: GoogleDriveManifestCatalogProvider
```

It reuses `DriveCatalogMaterializer` to:

- read `catalog_manifest.json`
- page through source products
- download `product_info.json` on demand
- normalize supplier product data
- hydrate selected product images into the local cache

The provider does not create a `haar_product_id` automatically. Product merging and HAAR product creation are later S4 steps.

## Default sources

When `GOOGLE_DRIVE_CATALOG_FOLDER_ID` is configured and no explicit source JSON is provided, the application creates one source definition:

```text
source_id: queensilver_20260811
source_type: supplier
provider_type: google_drive_manifest
canonical: false
```

Additional sources are configured with `ATELIER_CATALOG_SOURCES_JSON`.

## Sales channels

HAAR currently has two sales channels:

```text
haar_naver_smartstore
- channel_role: marketplace
- platform_type: naver_smartstore

haar_own_mall
- channel_role: owned_store
- platform_type: cafe24
- primary_domain: haar.co.kr
```

Cafe24 is the platform that operates the HAAR own mall. It is not a third channel.

The configuration rejects:

- duplicate channel IDs
- duplicate `(platform_type, external_store_id)` identities
- duplicate primary domains
- more than one Cafe24 owned-store channel

## HTTP API

```http
GET /api/v1/catalog/multi-source/status
GET /api/v1/catalog/sources
GET /api/v1/catalog/sources/{sourceId}
GET /api/v1/catalog/sources/{sourceId}/products
GET /api/v1/catalog/sources/{sourceId}/products/{sourceProductId}
POST /api/v1/catalog/sources/{sourceId}/products/{sourceProductId}/hydrate
GET /api/v1/sales-channels
GET /api/v1/sales-channels/{channelId}
GET /openapi-catalog.json
```

The hydrate action only downloads source files into the server cache. It does not modify the supplier Drive folder or any sales channel.

## Configuration

```dotenv
ATELIER_MULTI_SOURCE_CATALOG_ENABLED=true
ATELIER_MULTI_SOURCE_CACHE_DIR=/tmp/atelier-drive-cache/catalog-sources
ATELIER_DEFAULT_CATALOG_SOURCE_ID=queensilver_20260811
ATELIER_CATALOG_SOURCES_JSON=

ATELIER_NAVER_CHANNEL_ID=haar_naver_smartstore
ATELIER_OWN_MALL_CHANNEL_ID=haar_own_mall
CAFE24_MALL_ID=
HAAR_OWN_MALL_DOMAIN=haar.co.kr
ATELIER_SALES_CHANNELS_JSON=
```

## Database migrations

```text
0003_multi_source_product_catalog.sql
0004_sales_channel_platform_identity.sql
```

The runtime registry does not yet persist source-product ingestion into PostgreSQL. That is the next S4 milestone.

## Next step

S4.1/S4.2 will add:

1. source-product ingestion runs and persistence
2. manual product provider
3. generic Google Drive folder provider
4. HAAR product creation and explicit source-product linking
5. existing SmartStore and Cafe24 product reverse mapping
