# frontend

AtelierPopo 스토어프론트 프로토타입입니다. Next.js 15 / React 19로 만든 정적 UI이며, 상품 데이터는 `src/data/products.ts`에 들어 있고 이미지는 외부 `readdy.ai` URL과 `public/` 아래의 로컬 `/images/products/...` 파일을 함께 사용합니다.

## 실행

```bash
npm ci
npm run dev
```

## 범위와 한계

- `smartstore-bridge`와 연결되어 있지 않습니다.
- 자동화 테스트가 없습니다.
- 상품 데이터와 이미지는 정적입니다.
- `product-detail?id=13`의 로컬 썸네일 10개는 파일명의 쉼표를 `%2C`로 인코딩했습니다. Node 22.23.5/24.21.0에서 production build와 12개 route 응답을 확인했습니다. 최종 Node 22 production 서버에서 상세 이미지 12개 모두 HTTP 200 및 실제 브라우저 `naturalWidth > 0`을 확인했고, 홈 17/17·상품 목록 14/14 이미지도 정상입니다.
- clean `npm ci` 기준 이 스냅샷의 `npm audit`은 0입니다. 검증된 버전은 Next `15.5.29`, Tailwind `3.4.19`, Autoprefixer `10.6.2` 및 build-time transitive overrides입니다.
- 사용하지 않는 Firebase/Supabase/Stripe/i18next/Recharts 의존성은 제거했습니다.

## 의존성 호환성 / 검증 범위

- `glob 14.0.6`은 `tailwindcss 3.4.19 → sucrase 3.35.0` 아래에 설치되지만, sucrase는 `glob ^10.3.10`을 선언합니다. 이 override는 Tailwind build-time toolchain에만 쓰이는 **major 범위 밖 pin**이며, Node 22.23.5/24.21.0에서 clean `npm ci`, production build, 12개 route smoke로 검증했습니다. Tailwind/sucrase 변경 시 재검증이 필요합니다.
- `minimatch 11.0.8`은 `glob 14.0.6`의 `^11.0.5` 범위 안입니다. Node engine은 `20 || >=22`입니다.
- `brace-expansion 5.0.13`은 `minimatch 11.0.8`의 `^5.0.12` 범위 안입니다. Node engine은 `20 || >=22`입니다.
- `glob 14.0.6`의 Node engine은 `18 || 20 || >=22`입니다.
- `sharp 0.35.5`의 Node engine은 `>=20.9.0`이며, Next 15.5.29의 optional `sharp ^0.34.3 || ^0.35.5` 범위 안입니다.
- `postcss 8.5.33`은 Next 15.5.29의 exact `8.4.31`을 override하지만 같은 major이며, Tailwind의 `^8.4.47`을 만족합니다. build/page smoke로 검증했습니다.
- 나머지 override는 immediate parent 범위 안입니다: `picomatch 2.3.2` (micromatch `^2.3.1`, anymatch `^2.0.4`, readdirp `^2.2.1`), `yaml 2.9.1` (postcss-load-config `^2.3.4`), `postcss-selector-parser 6.1.6` (Tailwind `^6.1.2`), `browserslist 4.29.5` (autoprefixer `^4.28.9`), `baseline-browser-mapping 2.11.37` (browserslist `^2.11.33`), `nanoid 3.3.20` (postcss `^3.3.20`), `source-map-js 1.2.2` (postcss `^1.2.2`).
- Node 22.23.5와 24.21.0은 실제 테스트했습니다. Dependency engine상 Node 20.9+가 가능하지만 Node 20.x는 실행하지 않았고, Node 21은 glob/minimatch engine 범위에서 제외됩니다. Next/Tailwind/sucrase/override 변경 후 `npm ci`, `npm audit`, `npm run build`, 12개 route smoke를 다시 실행해야 합니다.

전체 저장소 개요는 [`../README.md`](../README.md)를 참고하세요.
