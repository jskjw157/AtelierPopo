"use client";

/**
 * 레오파드 리본 블랙 아크릴 집게핀 상세페이지
 * 쿠팡/네이버 등 외부 플랫폼용 - 도널드 밀러 스토리텔링 기법 적용
 */

export default function HairpinDetailExport() {
  return (
    <div
      className="font-pretendard bg-white"
      style={{ width: "860px", margin: "0 auto" }}
    >
      {/* Hero Section - 3초만에 완성되는 스타일 */}
      <section className="bg-gradient-to-b from-gray-50 to-white py-12 lg:py-16 px-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4 leading-tight">
            3초만에 완성되는,
            <br />
            <span className="text-pink-500">
              하루 종일 흐트러지지 않는 스타일
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-6">
            레오파드 리본 블랙 아크릴 집게핀
          </p>

          {/* 평점 및 리뷰 */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="flex items-center">
              {[...Array(5)].map((_, i) => (
                <i
                  key={i}
                  className="ri-star-fill text-yellow-400 text-2xl"
                ></i>
              ))}
              <span className="ml-2 text-2xl font-semibold text-gray-900">
                4.7
              </span>
            </div>
            <span className="text-gray-600 text-lg">
              실제 구매자 리뷰 5,263개
            </span>
          </div>

          {/* 핵심 통계 */}
          <div className="inline-flex items-center gap-3 bg-pink-50 border-2 border-pink-200 px-8 py-4 rounded-full mb-6">
            <span className="text-pink-600 font-bold text-lg">
              ⭐ 92.8%가 4점 이상 평가 · 2,796명이 "예쁘다" 극찬
            </span>
          </div>
        </div>

        {/* 대표 이미지 */}
        <div className="w-full bg-gray-50 rounded-2xl overflow-hidden mb-8">
          <img
            src="/images/products/hairpin/다운로드 (1).png"
            alt="레오파드 리본 블랙 아크릴 집게핀"
            className="w-full"
            style={{ display: "block" }}
          />
        </div>

        {/* 가격 정보 */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="text-4xl font-bold text-gray-900">8,900원</span>
            <span className="text-2xl text-gray-400 line-through">
              12,900원
            </span>
            <span className="bg-red-500 text-white px-4 py-2 rounded-full text-lg font-bold">
              31% 할인
            </span>
          </div>
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-6 py-3">
            <i className="ri-truck-line text-blue-600 text-2xl"></i>
            <span className="font-semibold text-blue-900 text-lg">
              무료배송 | 오늘 주문 시 내일 도착
            </span>
          </div>
        </div>
      </section>

      {/* Problem Section - 이런 고민 있으셨죠? */}
      <section className="py-16 bg-white px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            이런 고민, 있으셨죠?
          </h2>
          <p className="text-lg text-gray-600">
            바쁜 아침, 헤어 스타일링 때문에 스트레스 받으셨나요?
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200 hover:border-pink-300 transition-all">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-time-line text-red-500 text-4xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              시간이 없어요
            </h3>
            <p className="text-gray-600 leading-relaxed">
              출근 준비하다 보면 헤어 스타일링할 시간이 없어서 대충 묶고 나가게
              돼요
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200 hover:border-pink-300 transition-all">
            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-arrow-down-line text-orange-500 text-4xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              자꾸 흐트러져요
            </h3>
            <p className="text-gray-600 leading-relaxed">
              집게핀으로 고정해도 시간이 지나면 자꾸 흘러내려서 하루 종일 신경
              쓰여요
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200 hover:border-pink-300 transition-all">
            <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-open-arm-line text-yellow-600 text-4xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              스타일이 살지 않아요
            </h3>
            <p className="text-gray-600 leading-relaxed">
              단순한 헤어핀은 밋밋하고, 화려한 건 오피스룩에 안 어울려서
              고민이에요
            </p>
          </div>
        </div>
      </section>

      {/* Guide Section - 5,263명이 선택한 이유 */}
      <section className="py-16 bg-gradient-to-b from-pink-50 to-white px-8">
        <div className="text-center mb-12">
          <div className="inline-block bg-pink-100 text-pink-600 px-6 py-3 rounded-full text-lg font-semibold mb-4">
            검증된 베스트셀러
          </div>
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            5,263명이 선택한
            <br />
            <span className="text-pink-500">완벽한 헤어핀</span>
          </h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            2,796명이 "예쁘다"고 극찬하고, 92.8%가 4점 이상 평가한
            <br />
            <strong className="text-gray-900">
              블랙 베스트셀러 2,448개 판매!
            </strong>
          </p>
        </div>

        {/* 실제 고객 리뷰 통계 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">92.8%</div>
            <div className="text-sm text-gray-600">긍정 리뷰 비율</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">5,263</div>
            <div className="text-sm text-gray-600">실제 구매 리뷰</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">4.7점</div>
            <div className="text-sm text-gray-600">평균 평점</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">79.7%</div>
            <div className="text-sm text-gray-600">5점 만점 비율</div>
          </div>
        </div>

        {/* 실제 고객 후기 키워드 */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            실제 고객들이 가장 많이 언급한 키워드 TOP 10
          </h3>
          <div className="flex flex-wrap justify-center gap-4">
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #예쁘다 (2,796회 🎀)
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #좋아요 (1,373회)
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #잘잡혀요 (643회)
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #편하다 (384회)
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #만족 (378회)
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #깔끔 (239회)
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #튼튼 (116회)
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #고급스럽다 (104회)
            </span>
          </div>
        </div>

        {/* 실제 리뷰 하이라이트 */}
        <div className="mt-8 bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl p-8 border-2 border-purple-200">
          <h3 className="text-xl font-bold text-gray-900 mb-6 text-center">
            💬 실제 구매자 리뷰
          </h3>
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-6">
              <div className="flex items-center mb-2">
                <div className="flex text-yellow-400 text-sm mr-2">
                  ⭐⭐⭐⭐⭐
                </div>
                <span className="text-sm text-gray-600">5점</span>
              </div>
              <p className="text-gray-700">
                "리본이 적당히 풍성하고 적당히 컸으면 했습니다. 집게핀이
                짱짱하고 튼튼하구요 리본 마감도 깔끔하고 고정도 잘 되어 있어서
                예쁩니다."
              </p>
            </div>
            <div className="bg-white rounded-lg p-6">
              <div className="flex items-center mb-2">
                <div className="flex text-yellow-400 text-sm mr-2">
                  ⭐⭐⭐⭐⭐
                </div>
                <span className="text-sm text-gray-600">5점</span>
              </div>
              <p className="text-gray-700">
                "세 번째 구매!! 주름이 잘 잡혀서 딱 마음에 듭니다!!"
              </p>
            </div>
            <div className="bg-white rounded-lg p-6">
              <div className="flex items-center mb-2">
                <div className="flex text-yellow-400 text-sm mr-2">
                  ⭐⭐⭐⭐⭐
                </div>
                <span className="text-sm text-gray-600">5점</span>
              </div>
              <p className="text-gray-700">
                "퀄리티 좋아요. 보는것보다 머리에했을때 더 이쁘구요."
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 제품 이미지 1 */}
      <div className="w-full">
        <img
          src="/images/products/hairpin/KakaoTalk_20251111_125458213.jpg"
          alt="제품 상세 이미지 1"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* Solution Section - 7가지 핵심 강점 */}
      <section className="py-16 bg-white px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            7가지 핵심 강점으로
            <br />
            <span className="text-pink-500">
              완벽한 헤어 스타일을 완성합니다
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-flashlight-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  강력한 집게 탄성 및 내구성
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  유광 블랙 아크릴 바디로 제작되어 강력한 집게 탄성과 뛰어난
                  내구성을 자랑합니다
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-palette-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  레오파드 패턴 리본 디테일
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  그레이 톤 레오파드 패턴 리본으로 세련되고 시크한 무드를
                  연출합니다
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-t-shirt-2-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  F/W 시즌 최적화 텍스처
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  부드러운 퍼/펠트 느낌의 소재로 가을·겨울 코디에 완벽하게
                  어울립니다
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-focus-3-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  숱이 많아도 안정적 고정력
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  적당한 폭과 톱니 구조로 머리숱이 많아도 하루 종일 안정적으로
                  고정됩니다
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-time-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  3초 원터치 스타일링
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  한 손으로 '딱' 고정되는 원터치 사용성으로 출근 전 3초만에
                  완성!
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-contrast-2-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  모노톤 컬러의 높은 매칭력
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  블랙&그레이 모노톤으로 어떤 컬러 코디에도 쉽게 매칭됩니다
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200 lg:col-span-2">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-shield-check-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  헤어 자국 최소화 곡면 설계
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  헤어 컬 크리즈(자국)를 최소화하도록 설계된 곡면 구조로 일상
                  사용에 최적화되어 있습니다
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 제품 이미지 2-3 */}
      <div className="w-full">
        <img
          src="/images/products/hairpin/KakaoTalk_20251111_125458213_01.jpg"
          alt="제품 상세 이미지 2"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full">
        <img
          src="/images/products/hairpin/KakaoTalk_20251111_125458213_02.jpg"
          alt="제품 상세 이미지 3"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 착용샷 Section */}
      <section className="py-16 bg-gray-50 px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">착용샷</h2>
          <p className="text-lg text-gray-600">
            다양한 스타일로 만나보는 레오파드 리본 집게핀
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <img
              src="/images/products/hairpin/다운로드 (1).png"
              alt="착용샷 1"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/hairpin/KakaoTalk_20251111_125458213_03.jpg"
              alt="착용샷 2"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/hairpin/KakaoTalk_20251111_125458213_04.jpg"
              alt="착용샷 3"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div className="col-span-2">
            <img
              src="/images/products/hairpin/KakaoTalk_20251111_125458213_05.jpg"
              alt="착용샷 4"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/hairpin/KakaoTalk_20251111_125458213_06.jpg"
              alt="착용샷 5"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/hairpin/KakaoTalk_20251111_125458213_07.jpg"
              alt="착용샷 6"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
        </div>
      </section>

      {/* Success Section - 사용 후 기대 효과 */}
      <section className="py-16 bg-gradient-to-b from-pink-50 to-white px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            이 헤어핀과 함께라면
            <br />
            <span className="text-pink-500">당신의 하루가 달라집니다</span>
          </h2>
          <p className="text-lg text-gray-600">
            실제로 이 제품을 사용하신 고객님들이 경험한 변화들이에요
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white rounded-2xl p-8 text-center shadow-lg border border-gray-100">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-400 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="ri-shield-check-line text-white text-5xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              하루 종일 안정적 고정
            </h3>
            <p className="text-gray-600 leading-relaxed">
              올림머리·반묶음이 하루 종일 흐트러지지 않는 강력한 고정감으로
              언제나 완벽한 스타일 유지
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 text-center shadow-lg border border-gray-100">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-400 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="ri-star-smile-line text-white text-5xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              스타일 완성도 상승
            </h3>
            <p className="text-gray-600 leading-relaxed">
              레오파드 리본 포인트로 평범한 헤어가 즉시 세련된 스타일로
              업그레이드
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 text-center shadow-lg border border-gray-100">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-400 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="ri-user-smile-line text-white text-5xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              깔끔한 얼굴 라인
            </h3>
            <p className="text-gray-600 leading-relaxed">
              얼굴 윤곽이 또렷해 보이는 깔끔한 헤어 라인으로 더욱 세련된 인상
              연출
            </p>
          </div>
        </div>

        {/* 실제 사용 시나리오 */}
        <div className="mt-12 bg-white rounded-2xl p-8 shadow-lg border border-gray-100">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            이런 순간에 완벽해요
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center p-4">
              <div className="text-4xl mb-2">💼</div>
              <p className="text-sm font-medium text-gray-700">출근·오피스룩</p>
            </div>
            <div className="text-center p-4">
              <div className="text-4xl mb-2">👗</div>
              <p className="text-sm font-medium text-gray-700">하객·결혼식</p>
            </div>
            <div className="text-center p-4">
              <div className="text-4xl mb-2">📚</div>
              <p className="text-sm font-medium text-gray-700">캠퍼스·학교</p>
            </div>
            <div className="text-center p-4">
              <div className="text-4xl mb-2">☕</div>
              <p className="text-sm font-medium text-gray-700">데일리·데이트</p>
            </div>
          </div>
        </div>
      </section>

      {/* Plan Section - 구매 프로세스 */}
      <section className="py-16 bg-white px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            구매는 간단하게,
            <br />
            <span className="text-pink-500">3단계면 충분해요</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="relative">
            <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl p-8 text-white text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl font-bold text-pink-500">1</span>
              </div>
              <h3 className="text-xl font-bold mb-3">색상 & 수량 선택</h3>
              <p className="text-pink-100">원하시는 색상과 수량을 선택하세요</p>
            </div>
            <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
              <i className="ri-arrow-right-line text-5xl text-pink-300"></i>
            </div>
          </div>

          <div className="relative">
            <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl p-8 text-white text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl font-bold text-pink-500">2</span>
              </div>
              <h3 className="text-xl font-bold mb-3">주문하기 클릭</h3>
              <p className="text-pink-100">
                장바구니 또는 바로구매 버튼을 클릭
              </p>
            </div>
            <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
              <i className="ri-arrow-right-line text-5xl text-pink-300"></i>
            </div>
          </div>

          <div>
            <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl p-8 text-white text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl font-bold text-pink-500">3</span>
              </div>
              <h3 className="text-xl font-bold mb-3">내일 바로 배송</h3>
              <p className="text-pink-100">
                오늘 주문하면 내일 바로 받아보세요
              </p>
            </div>
          </div>
        </div>

        {/* 안심 구매 정보 */}
        <div className="mt-12 bg-gray-50 rounded-2xl p-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            안심하고 구매하세요
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <i className="ri-shield-check-line text-4xl text-green-500 mb-2"></i>
              <p className="text-sm font-medium text-gray-700">
                100% 정품 보증
              </p>
            </div>
            <div className="text-center">
              <i className="ri-refund-2-line text-4xl text-blue-500 mb-2"></i>
              <p className="text-sm font-medium text-gray-700">7일 무료 반품</p>
            </div>
            <div className="text-center">
              <i className="ri-customer-service-2-line text-4xl text-purple-500 mb-2"></i>
              <p className="text-sm font-medium text-gray-700">
                24시간 고객센터
              </p>
            </div>
            <div className="text-center">
              <i className="ri-secure-payment-line text-4xl text-orange-500 mb-2"></i>
              <p className="text-sm font-medium text-gray-700">안전한 결제</p>
            </div>
          </div>
        </div>
      </section>

      {/* 상세 스펙 & 주의사항 */}
      <section className="py-16 bg-gray-50 px-8">
        <div className="bg-white rounded-2xl p-12 shadow-sm border border-gray-100">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">상세 정보</h2>

          <div className="space-y-8">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <i className="ri-information-line text-pink-500 mr-2 text-3xl"></i>
                제품 사양
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">소재:</span>
                  <span className="ml-2 text-gray-600">
                    아크릴 · 패브릭(리본)
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">색상:</span>
                  <span className="ml-2 text-gray-600">
                    블랙 · 그레이 레오파드
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">사이즈:</span>
                  <span className="ml-2 text-gray-600">원사이즈</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">무게:</span>
                  <span className="ml-2 text-gray-600">약 20g (초경량)</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <i className="ri-lightbulb-line text-pink-500 mr-2 text-3xl"></i>
                사용 방법
              </h3>
              <div className="bg-gray-50 rounded-lg p-6">
                <ul className="space-y-3">
                  <li className="flex items-start">
                    <i className="ri-check-line text-green-500 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      머리를 모아 뒤로 정리한 뒤, 집게를 벌려 원하는 위치에
                      고정합니다
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-check-line text-green-500 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      올림머리·반묶음·하프업 등 다양한 스타일에 활용 가능합니다
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-check-line text-green-500 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      한 손으로 쉽게 고정되는 원터치 방식으로 3초만에 완성됩니다
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <i className="ri-alert-line text-pink-500 mr-2 text-3xl"></i>
                주의사항
              </h3>
              <div className="bg-yellow-50 rounded-lg p-6 border border-yellow-200">
                <ul className="space-y-3">
                  <li className="flex items-start">
                    <i className="ri-error-warning-line text-yellow-600 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      물/수분에 장시간 노출 금지, 강한 충격·압력 주의 (아크릴
                      파손 우려)
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-error-warning-line text-yellow-600 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      화기·고온 환경 보관 금지, 오염 시 마른 천으로 부분 손질
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-error-warning-line text-yellow-600 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      소재 특성상 미세한 털날림/패턴 차이가 있을 수 있습니다
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-error-warning-line text-yellow-600 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      장시간 같은 위치에 고정 시 헤어 자국이 생길 수 있으니
                      적절히 위치 변경을 권장합니다
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="w-full py-10 bg-gray-900 text-center">
        <p className="text-white text-lg mb-2 font-medium">
          레오파드 리본 블랙 아크릴 집게핀
        </p>
        <p className="text-gray-400">
          고객센터: 1588-0000 | 평일 09:00-18:00 (주말/공휴일 휴무)
        </p>
        <p className="text-gray-500 text-sm mt-2">
          블랙 베스트셀러 2,448개 판매! · 5,263명이 선택한 제품
        </p>
      </div>
    </div>
  );
}
