"use client";

/**
 * 쿠팡 스타일 상세페이지
 * 박스형 레이아웃, 강렬한 색상, 인포그래픽 스타일
 */

export default function MiniBagDetailCoupang() {
  return (
    <div className="font-pretendard bg-white" style={{ width: "860px", margin: "0 auto" }}>
      {/* 메인 히어로 배너 - 쿠팡 스타일 */}
      <div 
        className="relative w-full text-center text-white"
        style={{
          background: "linear-gradient(135deg, #ff6b9d 0%, #c44569 100%)",
          padding: "60px 40px",
        }}
      >
        <div className="mb-4">
          <span className="inline-block bg-white/20 px-6 py-2 rounded-full text-sm font-bold backdrop-blur-sm">
            ⭐ 베스트셀러 ⭐
          </span>
        </div>
        <h1 className="text-5xl font-bold mb-4 leading-tight drop-shadow-lg">
          매일 가벼운 나를 위한,
          <br />
          러블리한 선택
        </h1>
        <p className="text-2xl mb-6 font-medium opacity-95">
          러블리 펄 리본 참 퀼팅 소프트 토트백
        </p>
        
        {/* 가격 정보 - 쿠팡 스타일 강조 */}
        <div className="inline-block bg-white rounded-2xl px-10 py-6 shadow-2xl">
          <div className="flex items-center gap-4 justify-center mb-2">
            <span className="text-gray-400 line-through text-2xl">52,000원</span>
            <span className="bg-red-500 text-white px-4 py-2 rounded-lg text-xl font-bold">19% 할인</span>
          </div>
          <div className="text-5xl font-black text-pink-600">42,000원</div>
          <div className="mt-3 text-sm text-gray-600">
            ⚡ 오늘만 특가 + 무료배송
          </div>
        </div>

        {/* 별점 */}
        <div className="mt-6 flex items-center justify-center gap-2 text-lg">
          <div className="flex">
            {[...Array(5)].map((_, i) => (
              <span key={i} className="text-yellow-300 text-2xl drop-shadow">★</span>
            ))}
          </div>
          <span className="font-bold">4.5</span>
          <span className="opacity-90">|</span>
          <span className="opacity-90">실제 리뷰 154개</span>
        </div>
      </div>

      {/* 대표 이미지 */}
      <div className="w-full">
        <img 
          src="/images/products/miniBag/대표이미지.png" 
          alt="러블리 펄 리본 참 퀼팅 소프트 토트백 메인"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 빠른 혜택 정보 - 쿠팡 스타일 박스 */}
      <div className="w-full bg-gradient-to-r from-blue-50 to-purple-50 py-8 px-12">
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-6 text-center shadow-md border-2 border-blue-200">
            <div className="text-4xl mb-2">🚚</div>
            <div className="font-bold text-gray-900 mb-1">무료배송</div>
            <div className="text-xs text-gray-600">로켓배송 가능</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-md border-2 border-purple-200">
            <div className="text-4xl mb-2">↩️</div>
            <div className="font-bold text-gray-900 mb-1">7일 무료반품</div>
            <div className="text-xs text-gray-600">고객 만족 보장</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-md border-2 border-pink-200">
            <div className="text-4xl mb-2">🎁</div>
            <div className="font-bold text-gray-900 mb-1">선물포장</div>
            <div className="text-xs text-gray-600">무료 제공</div>
          </div>
          <div className="bg-white rounded-xl p-6 text-center shadow-md border-2 border-green-200">
            <div className="text-4xl mb-2">✅</div>
            <div className="font-bold text-gray-900 mb-1">100% 정품</div>
            <div className="text-xs text-gray-600">품질 보증</div>
          </div>
        </div>
      </div>

      {/* 왜 이 제품인가? - 쿠팡 스타일 강조 */}
      <div className="w-full py-12 px-12 bg-white">
        <div className="text-center mb-10">
          <div className="inline-block bg-gradient-to-r from-pink-500 to-purple-500 text-white px-8 py-3 rounded-full text-xl font-bold mb-4">
            🔥 지금 가장 핫한 선택! 🔥
          </div>
          <h2 className="text-4xl font-black text-gray-900 mb-3">
            154명이 선택한 이유
          </h2>
          <p className="text-lg text-gray-600">
            실제 구매자 87.7%가 "또 살래요" 라고 답했습니다!
          </p>
        </div>

        {/* 통계 박스 - 쿠팡 스타일 */}
        <div className="grid grid-cols-4 gap-4 mb-10">
          <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl p-8 text-center text-white shadow-lg">
            <div className="text-5xl font-black mb-2">87.7%</div>
            <div className="text-sm font-medium opacity-90">긍정 리뷰</div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-8 text-center text-white shadow-lg">
            <div className="text-5xl font-black mb-2">154</div>
            <div className="text-sm font-medium opacity-90">실제 리뷰</div>
          </div>
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-8 text-center text-white shadow-lg">
            <div className="text-5xl font-black mb-2">4.5</div>
            <div className="text-sm font-medium opacity-90">평균 평점</div>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl p-8 text-center text-white shadow-lg">
            <div className="text-5xl font-black mb-2">91.3%</div>
            <div className="text-sm font-medium opacity-90">재구매 의향</div>
          </div>
        </div>

        {/* 고객 후기 키워드 - 쿠팡 스타일 */}
        <div className="bg-gray-50 rounded-2xl p-8 border-2 border-gray-200">
          <h3 className="text-xl font-bold text-center mb-6">💬 실제 구매자들의 한마디</h3>
          <div className="flex flex-wrap justify-center gap-3">
            <span className="bg-pink-100 text-pink-700 px-6 py-3 rounded-full font-bold text-lg border-2 border-pink-300">
              #가볍게들고 👍
            </span>
            <span className="bg-blue-100 text-blue-700 px-6 py-3 rounded-full font-bold text-lg border-2 border-blue-300">
              #수납많이 📦
            </span>
            <span className="bg-purple-100 text-purple-700 px-6 py-3 rounded-full font-bold text-lg border-2 border-purple-300">
              #퀄팅예쁨 ✨
            </span>
            <span className="bg-green-100 text-green-700 px-6 py-3 rounded-full font-bold text-lg border-2 border-green-300">
              #편하게사용 😊
            </span>
            <span className="bg-orange-100 text-orange-700 px-6 py-3 rounded-full font-bold text-lg border-2 border-orange-300">
              #심플디자인 🎨
            </span>
          </div>
        </div>
      </div>

      {/* 제품 이미지 1 */}
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_41PM-Photoroom.png" 
          alt="제품 상세 이미지 1"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 이런 고민 해결! - 쿠팡 스타일 */}
      <div className="w-full py-12 px-12 bg-gradient-to-b from-yellow-50 to-orange-50">
        <div className="text-center mb-10">
          <div className="inline-block bg-red-500 text-white px-6 py-2 rounded-lg text-sm font-bold mb-4">
            ⚠️ 이런 고민 있으셨죠?
          </div>
          <h2 className="text-4xl font-black text-gray-900 mb-3">
            이제 걱정 끝! 완벽한 해결책
          </h2>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-8 shadow-lg border-l-8 border-red-500">
            <div className="flex items-center gap-6">
              <div className="text-6xl flex-shrink-0">😫</div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                  무거운 가방의 피로감
                  <span className="text-red-500">✗</span>
                </h3>
                <p className="text-gray-600 text-lg leading-relaxed">
                  가방 자체가 무거워서 오래 들고 다니면 어깨와 손이 너무 아프고, 장시간 외출이 부담스러워요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-lg border-l-8 border-orange-500">
            <div className="flex items-center gap-6">
              <div className="text-6xl flex-shrink-0">👗</div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                  스타일링의 어려움
                  <span className="text-red-500">✗</span>
                </h3>
                <p className="text-gray-600 text-lg leading-relaxed">
                  데일리로 들기 좋으면서도 사진 찍을 때 예쁜 가방을 찾기가 너무 어렵고, 코디하기가 힘들어요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-lg border-l-8 border-yellow-500">
            <div className="flex items-center gap-6">
              <div className="text-6xl flex-shrink-0">📦</div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                  수납공간의 불편함
                  <span className="text-red-500">✗</span>
                </h3>
                <p className="text-gray-600 text-lg leading-relaxed">
                  작으면 필요한 물건을 못 담고, 크면 물건이 안에서 뒤섞여서 찾기가 너무 불편해요
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 해결책 강조 */}
        <div className="mt-10 bg-gradient-to-r from-green-500 to-emerald-500 rounded-2xl p-10 text-center text-white shadow-2xl">
          <div className="text-6xl mb-4">✅</div>
          <h3 className="text-3xl font-black mb-3">이 가방 하나면 모든 고민 해결!</h3>
          <p className="text-xl font-medium opacity-95">가벼움 + 예쁨 + 실용성 = 완벽한 데일리백</p>
        </div>
      </div>

      {/* 제품 이미지 2 */}
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM-Photoroom.png" 
          alt="제품 상세 이미지 2"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 7가지 핵심 강점 - 쿠팡 스타일 박스형 */}
      <div className="w-full py-12 px-12 bg-white">
        <div className="text-center mb-10">
          <div className="inline-block bg-gradient-to-r from-blue-500 to-purple-500 text-white px-8 py-3 rounded-full text-xl font-bold mb-4">
            ⭐ 7가지 핵심 강점 ⭐
          </div>
          <h2 className="text-4xl font-black text-gray-900">
            왜 이 가방이 특별한가요?
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="bg-gradient-to-r from-pink-50 to-pink-100 rounded-2xl p-8 border-2 border-pink-300 shadow-md">
            <div className="flex items-start gap-6">
              <div className="bg-pink-500 text-white w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black flex-shrink-0 shadow-lg">
                1
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  ✨ 폭신한 다이아 퀼팅 소재
                </h3>
                <p className="text-gray-700 text-lg leading-relaxed">
                  가벼운 착용감과 포근한 그립감을 제공하는 두툼한 핸들로, 장시간 사용해도 손과 어깨가 전혀 피곤하지 않아요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-50 to-purple-100 rounded-2xl p-8 border-2 border-purple-300 shadow-md">
            <div className="flex items-start gap-6">
              <div className="bg-purple-500 text-white w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black flex-shrink-0 shadow-lg">
                2
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  💎 진주 리본 참 & 하트 펜던트
                </h3>
                <p className="text-gray-700 text-lg leading-relaxed">
                  시선을 사로잡는 포인트 디자인! 탈부착이 가능해서 기분에 따라 무드를 자유롭게 전환할 수 있어요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-2xl p-8 border-2 border-blue-300 shadow-md">
            <div className="flex items-start gap-6">
              <div className="bg-blue-500 text-white w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black flex-shrink-0 shadow-lg">
                3
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  📦 미니멀한 스퀘어 실루엣
                </h3>
                <p className="text-gray-700 text-lg leading-relaxed">
                  지갑, 파우치, 스마트폰, 소형 태블릿까지 일상 수납이 깔끔하게 정리되는 완벽한 수납력
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-orange-50 to-orange-100 rounded-2xl p-8 border-2 border-orange-300 shadow-md">
            <div className="flex items-start gap-6">
              <div className="bg-orange-500 text-white w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black flex-shrink-0 shadow-lg">
                4
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  👑 D-링 금속 장식
                </h3>
                <p className="text-gray-700 text-lg leading-relaxed">
                  고급스러운 마감으로 디테일까지 완벽! 참, 키링, 스트랩까지 다양하게 확장 활용 가능해요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-2xl p-8 border-2 border-green-300 shadow-md">
            <div className="flex items-start gap-6">
              <div className="bg-green-500 text-white w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black flex-shrink-0 shadow-lg">
                5
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  🎨 블랙 컬러의 높은 코디력
                </h3>
                <p className="text-gray-700 text-lg leading-relaxed">
                  은은한 광택이 더해진 블랙 컬러로 캐주얼부터 원피스까지 모든 룩에 완벽하게 매치돼요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-red-50 to-red-100 rounded-2xl p-8 border-2 border-red-300 shadow-md">
            <div className="flex items-start gap-6">
              <div className="bg-red-500 text-white w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black flex-shrink-0 shadow-lg">
                6
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  🔒 내부 지퍼 보안
                </h3>
                <p className="text-gray-700 text-lg leading-relaxed">
                  부드럽게 벌어지는 지퍼 상단으로 내용물이 안전하게 보호되어 분실 걱정이 전혀 없어요
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-indigo-50 to-indigo-100 rounded-2xl p-8 border-2 border-indigo-300 shadow-md">
            <div className="flex items-start gap-6">
              <div className="bg-indigo-500 text-white w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black flex-shrink-0 shadow-lg">
                7
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  🌸 꽃·리본 자수 포인트
                </h3>
                <p className="text-gray-700 text-lg leading-relaxed">
                  러블리 무드를 더욱 강화하는 섬세한 자수 디테일로 선물용으로도 만족도가 높아요
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 제품 이미지 3-4 */}
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (1)-Photoroom.png" 
          alt="제품 상세 이미지 3"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (3)-Photoroom.png" 
          alt="제품 상세 이미지 4"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* Before & After - 쿠팡 스타일 */}
      <div className="w-full py-12 px-12 bg-gradient-to-b from-gray-50 to-white">
        <div className="text-center mb-10">
          <div className="inline-block bg-gradient-to-r from-yellow-400 to-orange-400 text-white px-8 py-3 rounded-full text-xl font-bold mb-4">
            🎯 이 가방과 함께라면
          </div>
          <h2 className="text-4xl font-black text-gray-900">
            당신의 일상이 이렇게 달라집니다!
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-8 shadow-lg border-4 border-pink-200">
            <div className="bg-gradient-to-br from-pink-500 to-pink-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <span className="text-4xl">📸</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3 text-center">
              코디 완성도 상승
            </h3>
            <p className="text-gray-600 text-center leading-relaxed">
              사진이나 거울샷에서 포인트가 되어 인스타그램 감성 업! 친구들에게 어디서 샀냐는 질문 폭주
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-lg border-4 border-blue-200">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <span className="text-4xl">💪</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3 text-center">
              피로감 감소
            </h3>
            <p className="text-gray-600 text-center leading-relaxed">
              장시간 외출에도 손과 어깨가 편안해서 데이트, 쇼핑, 여행까지 하루 종일 OK
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-lg border-4 border-purple-200">
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <span className="text-4xl">✨</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3 text-center">
              활용도 극대화
            </h3>
            <p className="text-gray-600 text-center leading-relaxed">
              데일리, 데이트, 주말 나들이까지 한 개로 모든 상황을 커버하는 만능 아이템
            </p>
          </div>
        </div>

        {/* 사용 시나리오 - 쿠팡 스타일 */}
        <div className="mt-10 bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl p-8 border-2 border-purple-200">
          <h3 className="text-2xl font-bold text-center mb-8">💝 이런 순간에 완벽해요!</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-6 text-center shadow-md">
              <div className="text-5xl mb-3">☕</div>
              <p className="font-bold text-gray-900">카페 데이트</p>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-md">
              <div className="text-5xl mb-3">🛍️</div>
              <p className="font-bold text-gray-900">쇼핑</p>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-md">
              <div className="text-5xl mb-3">📚</div>
              <p className="font-bold text-gray-900">캠퍼스 라이프</p>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-md">
              <div className="text-5xl mb-3">💼</div>
              <p className="font-bold text-gray-900">출퇴근</p>
            </div>
          </div>
        </div>
      </div>

      {/* 제품 이미지 5-6 */}
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (4)-Photoroom.png" 
          alt="제품 상세 이미지 5"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (5)-Photoroom.png" 
          alt="제품 상세 이미지 6"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 구매 프로세스 - 쿠팡 스타일 */}
      <div className="w-full py-12 px-12 bg-white">
        <div className="text-center mb-10">
          <div className="inline-block bg-gradient-to-r from-green-500 to-emerald-500 text-white px-8 py-3 rounded-full text-xl font-bold mb-4">
            🚀 초간단 구매 프로세스
          </div>
          <h2 className="text-4xl font-black text-gray-900">
            3단계만 거치면 바로 내 것!
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-6 mb-10">
          <div className="relative">
            <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl p-10 text-white text-center shadow-xl">
              <div className="bg-white text-pink-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl font-black">
                1
              </div>
              <h3 className="text-2xl font-bold mb-4">색상 & 수량 선택</h3>
              <p className="text-pink-100 text-lg">
                원하시는 옵션 선택
              </p>
            </div>
            <div className="absolute -right-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-5xl hidden lg:block">
              →
            </div>
          </div>

          <div className="relative">
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-10 text-white text-center shadow-xl">
              <div className="bg-white text-purple-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl font-black">
                2
              </div>
              <h3 className="text-2xl font-bold mb-4">주문하기 클릭</h3>
              <p className="text-purple-100 text-lg">
                간편한 결제 진행
              </p>
            </div>
            <div className="absolute -right-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-5xl hidden lg:block">
              →
            </div>
          </div>

          <div>
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-10 text-white text-center shadow-xl">
              <div className="bg-white text-blue-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl font-black">
                3
              </div>
              <h3 className="text-2xl font-bold mb-4">빠른 배송</h3>
              <p className="text-blue-100 text-lg">
                빠르고 안전하게 도착
              </p>
            </div>
          </div>
        </div>

        {/* 안심 구매 정보 - 쿠팡 스타일 */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-8 border-2 border-blue-200">
          <h3 className="text-2xl font-bold text-center mb-8">🛡️ 안심하고 구매하세요</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
                <span className="text-3xl">✅</span>
              </div>
              <p className="font-bold text-gray-900">100% 정품 보증</p>
            </div>
            <div className="text-center">
              <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
                <span className="text-3xl">↩️</span>
              </div>
              <p className="font-bold text-gray-900">7일 무료 반품</p>
            </div>
            <div className="text-center">
              <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
                <span className="text-3xl">📞</span>
              </div>
              <p className="font-bold text-gray-900">24시간 고객센터</p>
            </div>
            <div className="text-center">
              <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
                <span className="text-3xl">💳</span>
              </div>
              <p className="font-bold text-gray-900">안전한 결제</p>
            </div>
          </div>
        </div>
      </div>

      {/* 제품 이미지 7-8 */}
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_59PM-Photoroom.png" 
          alt="제품 상세 이미지 7"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 9_02PM-Photoroom.png" 
          alt="제품 상세 이미지 8"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 상세 스펙 - 쿠팡 스타일 테이블 */}
      <div className="w-full py-12 px-12 bg-gray-50">
        <div className="bg-white rounded-2xl p-10 shadow-lg">
          <h2 className="text-3xl font-black text-gray-900 mb-8 text-center">
            📋 상세 정보
          </h2>

          <div className="space-y-8">
            {/* 제품 사양 */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-pink-500">
                🔍 제품 사양
              </h3>
              <table className="w-full">
                <tbody>
                  <tr className="border-b border-gray-200">
                    <td className="py-4 px-6 bg-gray-50 font-bold text-gray-700 w-1/3">소재</td>
                    <td className="py-4 px-6 text-gray-900">폴리에스터 퀼팅 패브릭</td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="py-4 px-6 bg-gray-50 font-bold text-gray-700">색상</td>
                    <td className="py-4 px-6 text-gray-900">블랙</td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="py-4 px-6 bg-gray-50 font-bold text-gray-700">사이즈</td>
                    <td className="py-4 px-6 text-gray-900">원사이즈 (스퀘어 미니)</td>
                  </tr>
                  <tr>
                    <td className="py-4 px-6 bg-gray-50 font-bold text-gray-700">무게</td>
                    <td className="py-4 px-6 text-gray-900">약 250g (초경량)</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 사용 방법 */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-500">
                💡 사용 방법
              </h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                  <span className="text-blue-500 font-bold text-lg">✓</span>
                  <p className="text-gray-700">진주 리본 참은 탈부착이 가능하므로 기분에 따라 연출하세요</p>
                </div>
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                  <span className="text-blue-500 font-bold text-lg">✓</span>
                  <p className="text-gray-700">내부 지퍼를 활용하여 소중한 물건을 안전하게 보관하세요</p>
                </div>
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                  <span className="text-blue-500 font-bold text-lg">✓</span>
                  <p className="text-gray-700">D-링에 키링이나 스트랩을 추가하여 나만의 스타일로 꾸며보세요</p>
                </div>
              </div>
            </div>

            {/* 주의사항 */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-orange-500">
                ⚠️ 주의사항
              </h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-orange-50 rounded-lg border-l-4 border-orange-500">
                  <span className="text-orange-500 font-bold text-lg">!</span>
                  <p className="text-gray-700"><strong>진주 리본 참</strong>은 강한 충격이나 걸림에 주의하고 필요 시 분리 보관하세요</p>
                </div>
                <div className="flex items-start gap-3 p-4 bg-orange-50 rounded-lg border-l-4 border-orange-500">
                  <span className="text-orange-500 font-bold text-lg">!</span>
                  <p className="text-gray-700"><strong>금속 장식</strong>은 향수, 땀, 수분과 장시간 접촉 시 변색 가능—사용 후 마른 천으로 가볍게 닦아 보관</p>
                </div>
                <div className="flex items-start gap-3 p-4 bg-orange-50 rounded-lg border-l-4 border-orange-500">
                  <span className="text-orange-500 font-bold text-lg">!</span>
                  <p className="text-gray-700">밝은 의류와 장시간 밀착 시 <strong>이염 우려</strong>가 있으니 초기 사용 시 주의하세요</p>
                </div>
                <div className="flex items-start gap-3 p-4 bg-orange-50 rounded-lg border-l-4 border-orange-500">
                  <span className="text-orange-500 font-bold text-lg">!</span>
                  <p className="text-gray-700">형태 유지를 위해 과도한 적재를 금지하고, 사용하지 않을 때는 충전재를 넣어 보관하세요</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 제품 이미지 9-10 */}
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 9_03PM-Photoroom.png" 
          alt="제품 상세 이미지 9"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full">
        <img 
          src="/images/products/miniBag/Generated Image October 09, 2025 - 9_06PM-Photoroom.png" 
          alt="제품 상세 이미지 10"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 최종 구매 촉구 - 쿠팡 스타일 강렬한 CTA */}
      <div 
        className="w-full py-16 text-center"
        style={{
          background: "linear-gradient(135deg, #ff6b9d 0%, #c44569 100%)",
        }}
      >
        <div className="animate-bounce mb-6">
          <span className="text-6xl">🔥</span>
        </div>
        <h2 className="text-5xl font-black text-white mb-4 drop-shadow-lg">
          지금이 아니면
          <br />
          이 가격에 만날 수 없어요!
        </h2>
        <div className="inline-block bg-white rounded-2xl px-12 py-6 shadow-2xl mb-8">
          <div className="text-red-500 text-4xl font-black mb-2">
            오늘만 특별 할인 19%
          </div>
          <div className="text-2xl text-gray-700 font-bold">
            + 무료배송 + 7일 무료반품
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 max-w-2xl mx-auto mb-8 border-2 border-white/30">
          <div className="text-white text-2xl font-bold mb-4">
            ⏰ 재고 한정! 서둘러주세요
          </div>
          <p className="text-pink-100 text-lg mb-2">
            1,247명이 이 상품을 보고 있습니다
          </p>
          <p className="text-white text-xl font-bold">
            ✓ 100% 정품 보증  ✓ 24시간 고객센터  ✓ 안전한 결제
          </p>
        </div>

        <div className="pt-6 border-t-2 border-white/30 max-w-2xl mx-auto">
          <p className="text-2xl text-white font-bold mb-3">
            "이 가방을 놓치면 후회할 거예요!"
          </p>
          <div className="flex items-center justify-center gap-1 text-3xl mb-2">
            <span>⭐</span><span>⭐</span><span>⭐</span><span>⭐</span><span>⭐</span>
          </div>
          <p className="text-xl text-pink-100">
            154명의 고객이 이미 만족하고 계십니다
          </p>
        </div>
      </div>

      {/* 푸터 */}
      <div className="w-full py-10 bg-gray-900 text-center">
        <p className="text-white text-lg mb-2 font-medium">
          러블리 펄 리본 참 퀼팅 소프트 토트백 (블랙)
        </p>
        <p className="text-gray-400 text-sm">
          고객센터: 1588-0000 | 평일 09:00-18:00 (주말/공휴일 휴무)
        </p>
        <p className="text-gray-500 text-xs mt-4">
          100% 정품 보증 | 7일 무료 반품 | 안전한 결제
        </p>
      </div>
    </div>
  );
}

