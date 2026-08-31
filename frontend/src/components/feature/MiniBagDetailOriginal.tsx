"use client";

/**
 * MiniBagDetail.tsx 디자인 기반 상세페이지
 * 쿠팡/네이버 등 외부 플랫폼용 독립 상세페이지
 */

export default function MiniBagDetailOriginal() {
  return (
    <div
      className="font-pretendard bg-white"
      style={{ width: "860px", margin: "0 auto" }}
    >
      {/* Hero Section - 매일 가벼운 나를 위한 */}
      <section className="bg-gradient-to-b from-pink-50 to-white py-12 lg:py-16 px-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4 leading-tight">
            매일 가벼운 나를 위한,
            <br />
            <span className="text-pink-500">러블리한 선택</span>
          </h1>
          <p className="text-xl text-gray-600 mb-6">
            10대 후반~30대 여성을 위한 데일리 토트백
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
                4.5
              </span>
            </div>
            <span className="text-gray-600 text-lg">
              실제 구매자 리뷰 154개
            </span>
          </div>
        </div>

        {/* 대표 이미지 */}
        <div className="w-full bg-gray-50 rounded-2xl overflow-hidden mb-8">
          <img
            src="/images/products/miniBag/대표이미지.png"
            alt="러블리 펄 리본 참 퀼팅 소프트 토트백"
            className="w-full"
            style={{ display: "block" }}
          />
        </div>

        {/* 가격 정보 */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="text-4xl font-bold text-gray-900">42,000원</span>
            <span className="text-2xl text-gray-400 line-through">
              52,000원
            </span>
            <span className="bg-red-500 text-white px-4 py-2 rounded-full text-lg font-bold">
              19% 할인
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

      {/* Problem Section - 고객의 문제 인식 */}
      <section className="py-16 bg-white px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            이런 고민, 있으셨나요?
          </h2>
          <p className="text-lg text-gray-600">
            매일 사용하는 가방이지만, 이런 불편함을 느끼고 계셨을 거예요
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200 hover:border-pink-300 transition-all">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-heavy-showers-line text-red-500 text-4xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              무거운 가방의 피로감
            </h3>
            <p className="text-gray-600 leading-relaxed">
              가방 자체가 무거워서 오래 들고 다니면 어깨와 손이 너무 아프고,
              장시간 외출이 부담스러워요
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200 hover:border-pink-300 transition-all">
            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-shirt-line text-orange-500 text-4xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              스타일링의 어려움
            </h3>
            <p className="text-gray-600 leading-relaxed">
              데일리로 들기 좋으면서도 사진 찍을 때 예쁜 가방을 찾기가 너무
              어렵고, 코디하기가 힘들어요
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200 hover:border-pink-300 transition-all">
            <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-folder-open-line text-yellow-600 text-4xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              수납공간의 불편함
            </h3>
            <p className="text-gray-600 leading-relaxed">
              작으면 필요한 물건을 못 담고, 크면 물건이 안에서 뒤섞여서 찾기가
              너무 불편해요
            </p>
          </div>
        </div>
      </section>

      {/* Guide Section - 브랜드가 가이드 역할 */}
      <section className="py-16 bg-gradient-to-b from-pink-50 to-white px-8">
        <div className="text-center mb-12">
          <div className="inline-block bg-pink-100 text-pink-600 px-6 py-3 rounded-full text-lg font-semibold mb-4">
            AtelierPopo가 답을 찾았습니다
          </div>
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            가볍고, 예쁘고, 실용적인
            <br />
            <span className="text-pink-500">완벽한 데일리백</span>
          </h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            수많은 고객님들의 리뷰를 분석하고, 실제 사용 피드백을 반영하여
            <br />
            <strong className="text-gray-900">
              평점 4.5점, 154개의 실제 구매 리뷰
            </strong>
            를 받은 검증된 제품입니다
          </p>
        </div>

        {/* 실제 고객 리뷰 통계 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">87.7%</div>
            <div className="text-sm text-gray-600">긍정 리뷰 비율</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">154개</div>
            <div className="text-sm text-gray-600">실제 구매 리뷰</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">4.5점</div>
            <div className="text-sm text-gray-600">평균 평점</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-bold text-pink-500 mb-2">91.3%</div>
            <div className="text-sm text-gray-600">재구매 의향</div>
          </div>
        </div>

        {/* 실제 고객 후기 키워드 */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            실제 고객들이 가장 많이 언급한 키워드 TOP 5
          </h3>
          <div className="flex flex-wrap justify-center gap-4">
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #가볍게들고
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #수납많이
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #퀄팅예쁨
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #편하게사용
            </span>
            <span className="bg-pink-100 text-pink-700 px-8 py-4 rounded-full font-semibold text-xl">
              #심플디자인
            </span>
          </div>
        </div>
      </section>

      {/* Solution Section - 7가지 핵심 강점 */}
      <section className="py-16 bg-white px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            7가지 핵심 강점으로
            <br />
            <span className="text-pink-500">당신의 데일리를 완성합니다</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-bubble-chart-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  폭신한 다이아 퀼팅 소재
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  가벼운 착용감과 포근한 그립감을 제공하는 두툼한 핸들로, 장시간
                  사용해도 손과 어깨가 전혀 피곤하지 않아요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-drop-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  진주 리본 참 & 하트 펜던트
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  시선을 사로잡는 포인트 디자인! 탈부착이 가능해서 기분에 따라
                  무드를 자유롭게 전환할 수 있어요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-inbox-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  미니멀한 스퀘어 실루엣
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  지갑, 파우치, 스마트폰, 소형 태블릿까지 일상 수납이 깔끔하게
                  정리되는 완벽한 수납력
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-vip-crown-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  D-링 금속 장식
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  고급스러운 마감으로 디테일까지 완벽! 참, 키링, 스트랩까지
                  다양하게 확장 활용 가능해요
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
                  블랙 컬러의 높은 코디력
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  은은한 광택이 더해진 블랙 컬러로 캐주얼부터 원피스까지 모든
                  룩에 완벽하게 매치돼요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-lock-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  내부 지퍼 보안
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  부드럽게 벌어지는 지퍼 상단으로 내용물이 안전하게 보호되어
                  분실 걱정이 전혀 없어요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-50 to-white rounded-2xl p-8 border-2 border-pink-200 lg:col-span-2">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-heart-3-line text-white text-3xl"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  꽃·리본 자수 포인트
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  러블리 무드를 더욱 강화하는 섬세한 자수 디테일로 선물용으로도
                  만족도가 높아요. 받는 사람도, 선물하는 사람도 모두 행복한
                  선택!
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 착용샷 Section - 11개 이미지 */}
      <section className="py-16 bg-gray-50 px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">착용샷</h2>
          <p className="text-lg text-gray-600">
            다양한 각도에서 만나보는 러블리 펄 리본 참 퀼팅 소프트 토트백
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <img
              src="/images/products/miniBag/대표이미지.png"
              alt="착용샷 1"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 8_41PM-Photoroom.png"
              alt="착용샷 2"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM-Photoroom.png"
              alt="착용샷 3"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (1)-Photoroom.png"
              alt="착용샷 4"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (3)-Photoroom.png"
              alt="착용샷 5"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div className="col-span-2">
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (4)-Photoroom.png"
              alt="착용샷 6"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (5)-Photoroom.png"
              alt="착용샷 7"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 8_59PM-Photoroom.png"
              alt="착용샷 8"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 9_02PM-Photoroom.png"
              alt="착용샷 9"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div>
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 9_03PM-Photoroom.png"
              alt="착용샷 10"
              className="w-full rounded-2xl"
              style={{ display: "block" }}
            />
          </div>
          <div className="col-span-2">
            <img
              src="/images/products/miniBag/Generated Image October 09, 2025 - 9_06PM-Photoroom.png"
              alt="착용샷 11"
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
            이 가방과 함께라면
            <br />
            <span className="text-pink-500">당신의 일상이 달라집니다</span>
          </h2>
          <p className="text-lg text-gray-600">
            실제로 이 제품을 사용하신 고객님들이 경험한 변화들이에요
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white rounded-2xl p-8 text-center shadow-lg border border-gray-100">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-400 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="ri-camera-line text-white text-5xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              코디 완성도 상승
            </h3>
            <p className="text-gray-600 leading-relaxed">
              사진이나 거울샷에서 포인트가 되어 인스타그램 감성 업! 친구들에게
              어디서 샀냐는 질문을 가장 많이 받는 아이템
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 text-center shadow-lg border border-gray-100">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-400 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="ri-heart-pulse-line text-white text-5xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              피로감 감소
            </h3>
            <p className="text-gray-600 leading-relaxed">
              장시간 외출에도 손과 어깨가 편안해서 데이트, 쇼핑, 여행까지 하루
              종일 활동해도 전혀 부담이 없어요
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 text-center shadow-lg border border-gray-100">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-400 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="ri-calendar-check-line text-white text-5xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">
              활용도 극대화
            </h3>
            <p className="text-gray-600 leading-relaxed">
              데일리, 데이트, 주말 나들이까지 한 개로 모든 상황을 커버! 가방
              하나로 모든 코디가 완성되는 편리함
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
              <div className="text-4xl mb-2">☕</div>
              <p className="text-sm font-medium text-gray-700">카페 데이트</p>
            </div>
            <div className="text-center p-4">
              <div className="text-4xl mb-2">🛍️</div>
              <p className="text-sm font-medium text-gray-700">쇼핑</p>
            </div>
            <div className="text-center p-4">
              <div className="text-4xl mb-2">📚</div>
              <p className="text-sm font-medium text-gray-700">캠퍼스 라이프</p>
            </div>
            <div className="text-center p-4">
              <div className="text-4xl mb-2">💼</div>
              <p className="text-sm font-medium text-gray-700">출퇴근</p>
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
                <i className="ri-ruler-line text-pink-500 mr-2 text-3xl"></i>
                제품 사양
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">소재:</span>
                  <span className="ml-2 text-gray-600">
                    폴리에스터 퀼팅 패브릭
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">색상:</span>
                  <span className="ml-2 text-gray-600">블랙</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">사이즈:</span>
                  <span className="ml-2 text-gray-600">
                    원사이즈 (스퀘어 미니)
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <span className="font-semibold text-gray-700">무게:</span>
                  <span className="ml-2 text-gray-600">약 250g (초경량)</span>
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
                      진주 리본 참은 탈부착이 가능하므로 기분에 따라 연출하세요
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-check-line text-green-500 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      내부 지퍼를 활용하여 소중한 물건을 안전하게 보관하세요
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-check-line text-green-500 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      D-링에 키링이나 스트랩을 추가하여 나만의 스타일로
                      꾸며보세요
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
                      <strong>진주 리본 참</strong>은 강한 충격이나 걸림에
                      주의하고 필요 시 분리 보관하세요
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-error-warning-line text-yellow-600 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      <strong>금속 장식</strong>은 향수, 땀, 수분과 장시간 접촉
                      시 변색 가능—사용 후 마른 천으로 가볍게 닦아 보관
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-error-warning-line text-yellow-600 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      밝은 의류와 장시간 밀착 시 <strong>이염 우려</strong>가
                      있으니 초기 사용 시 주의하세요
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="ri-error-warning-line text-yellow-600 mr-3 mt-1 text-2xl"></i>
                    <span className="text-gray-700">
                      형태 유지를 위해 과도한 적재를 금지하고, 사용하지 않을
                      때는 충전재를 넣어 보관하세요
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
          러블리 펄 리본 참 퀼팅 소프트 토트백 (블랙)
        </p>
        <p className="text-gray-400">
          고객센터: 1588-0000 | 평일 09:00-18:00 (주말/공휴일 휴무)
        </p>
      </div>
    </div>
  );
}
