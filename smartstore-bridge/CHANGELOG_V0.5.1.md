# Changelog v0.5.1

## Multi-source product foundation

- QueenSilver is now modeled as the first catalog source, not the global product identity.
- Added `(source_id, source_product_id)` source-product identity.
- Added runtime catalog source registry and provider contract.
- Added Google Drive manifest provider backed by `DriveCatalogMaterializer`.
- Added source pagination, normalized source-product lookup and asset hydration.
- Added separate HAAR sales-channel identity model.

## Cafe24 / own-mall correction

HAAR own mall and Cafe24 are one sales channel:

```text
channel_id: haar_own_mall
channel_role: owned_store
platform_type: cafe24
primary_domain: haar.co.kr
```

The configuration rejects duplicate Cafe24 own-mall channels.

## HTTP API

- `GET /api/v1/catalog/multi-source/status`
- `GET /api/v1/catalog/sources`
- `GET /api/v1/catalog/sources/{sourceId}`
- `GET /api/v1/catalog/sources/{sourceId}/products`
- `GET /api/v1/catalog/sources/{sourceId}/products/{sourceProductId}`
- `POST /api/v1/catalog/sources/{sourceId}/products/{sourceProductId}/hydrate`
- `GET /api/v1/sales-channels`
- `GET /api/v1/sales-channels/{channelId}`
- `GET /openapi-catalog.json`

## Database

The implementation uses the previously added migrations:

- `0003_multi_source_product_catalog.sql`
- `0004_sales_channel_platform_identity.sql`

## Safety and compatibility

- Existing legacy QueenSilver catalog endpoints remain available.
- Absolute cache paths are not returned by the source-provider API.
- Unsupported provider types remain visible but report `PROVIDER_NOT_REGISTERED` rather than being silently ignored.
- SearchAd and Commerce write gates remain unchanged.
