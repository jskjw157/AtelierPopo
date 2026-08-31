"use client";

/**
 * 쿠팡/네이버 스마트스토어용 상세페이지 컨텐츠
 * 실제 상세페이지 스타일 반영 - 미니멀하고 고급스러운 디자인
 */

export default function MiniBagDetailExport() {
  return (
    <div
      className="font-pretendard bg-white"
      style={{ width: "860px", margin: "0 auto" }}
    >
      {/* 메인 타이틀 - 미니멀 스타일 */}
      <div className="relative w-full py-20 text-center bg-white">
        <div className="mb-3">
          <span className="text-sm tracking-widest text-gray-500 font-light uppercase">
            Daily Essential
          </span>
        </div>
        <h1
          className="text-4xl font-light text-gray-900 mb-6 leading-relaxed"
          style={{ letterSpacing: "-0.5px" }}
        >
          매일 가벼운 나를 위한,
          <br />
          러블리한 선택
        </h1>
        <div className="w-16 h-0.5 bg-gray-900 mx-auto mb-8"></div>
        <p
          className="text-lg text-gray-600 font-light mb-8"
          style={{ letterSpacing: "0.5px" }}
        >
          러블리 펄 리본 참 퀼팅 소프트 토트백
        </p>
        <div className="inline-flex items-center gap-2 text-sm text-gray-500">
          <div className="flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <span key={i} className="text-yellow-400 text-base">
                ★
              </span>
            ))}
          </div>
          <span className="font-medium text-gray-900">4.5</span>
          <span>·</span>
          <span>154 Reviews</span>
        </div>
      </div>

      {/* 메인 제품 이미지 */}
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/대표이미지.png"
          alt="러블리 펄 리본 참 퀼팅 소프트 토트백 메인"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 제품 소개 텍스트 - 미니멀 */}
      <div className="w-full py-16 px-20 bg-white text-center">
        <p
          className="text-base text-gray-600 leading-loose mb-8"
          style={{ letterSpacing: "0.3px" }}
        >
          가벼운 패브릭 퀼팅과 폭신한 핸들로 장시간 들어도 부담이 적고,
          <br />
          진주 리본 참과 하트 펜던트로 포인트를 더한 '사진 잘 받는
          데일리백'입니다.
          <br />
          베이직한 블랙 컬러에 러블리한 디테일을 더해 사계절 다양한 코디에
          매칭됩니다.
        </p>
      </div>

      {/* 제품 상세 이미지 1 */}
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_41PM-Photoroom.png"
          alt="제품 상세 이미지 1"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 섹션 타이틀 - 이런 고민 */}
      <div className="w-full py-16 px-20 bg-white">
        <div className="text-center mb-12">
          <h2
            className="text-2xl font-light text-gray-900 mb-8"
            style={{ letterSpacing: "-0.3px" }}
          >
            이런 고민, 있으셨나요?
          </h2>
          <div className="w-12 h-0.5 bg-gray-300 mx-auto"></div>
        </div>

        <div className="space-y-8">
          <div className="text-center py-6 border-b border-gray-100">
            <h3 className="text-lg font-medium text-gray-900 mb-3">
              무거운 가방의 피로감
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              가방 자체가 무거워서 오래 들고 다니면 어깨와 손이 너무 아프고,
              <br />
              장시간 외출이 부담스러워요
            </p>
          </div>

          <div className="text-center py-6 border-b border-gray-100">
            <h3 className="text-lg font-medium text-gray-900 mb-3">
              스타일링의 어려움
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              데일리로 들기 좋으면서도 사진 찍을 때 예쁜 가방을 찾기가 너무
              어렵고,
              <br />
              코디하기가 힘들어요
            </p>
          </div>

          <div className="text-center py-6">
            <h3 className="text-lg font-medium text-gray-900 mb-3">
              수납공간의 불편함
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              작으면 필요한 물건을 못 담고, 크면 물건이 안에서 뒤섞여서
              <br />
              찾기가 너무 불편해요
            </p>
          </div>
        </div>
      </div>

      {/* 제품 상세 이미지 2 */}
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM-Photoroom.png"
          alt="제품 상세 이미지 2"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 고객 리뷰 통계 - 미니멀 */}
      <div className="w-full py-16 px-20 bg-white">
        <div className="text-center mb-12">
          <h2
            className="text-2xl font-light text-gray-900 mb-2"
            style={{ letterSpacing: "-0.3px" }}
          >
            154명이 검증한 완벽한 데일리백
          </h2>
          <div className="w-12 h-0.5 bg-gray-300 mx-auto mt-8"></div>
        </div>

        <div className="grid grid-cols-4 gap-6 mb-12">
          <div className="text-center py-6">
            <div className="text-3xl font-light text-gray-900 mb-2">87.7%</div>
            <div className="text-xs text-gray-500 tracking-wide">긍정 리뷰</div>
          </div>
          <div className="text-center py-6">
            <div className="text-3xl font-light text-gray-900 mb-2">154</div>
            <div className="text-xs text-gray-500 tracking-wide">실제 리뷰</div>
          </div>
          <div className="text-center py-6">
            <div className="text-3xl font-light text-gray-900 mb-2">4.5</div>
            <div className="text-xs text-gray-500 tracking-wide">평균 평점</div>
          </div>
          <div className="text-center py-6">
            <div className="text-3xl font-light text-gray-900 mb-2">91.3%</div>
            <div className="text-xs text-gray-500 tracking-wide">
              재구매 의향
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-xs text-gray-500 tracking-widest mb-4">
            CUSTOMER KEYWORDS
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <span className="text-xs text-gray-600 px-4 py-2 border border-gray-200 tracking-wide">
              가볍게 들고
            </span>
            <span className="text-xs text-gray-600 px-4 py-2 border border-gray-200 tracking-wide">
              수납 많이
            </span>
            <span className="text-xs text-gray-600 px-4 py-2 border border-gray-200 tracking-wide">
              퀄팅 예쁨
            </span>
            <span className="text-xs text-gray-600 px-4 py-2 border border-gray-200 tracking-wide">
              편하게 사용
            </span>
            <span className="text-xs text-gray-600 px-4 py-2 border border-gray-200 tracking-wide">
              심플 디자인
            </span>
          </div>
        </div>
      </div>

      {/* 제품 상세 이미지 3-4 */}
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (1)-Photoroom.png"
          alt="제품 상세 이미지 3"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (3)-Photoroom.png"
          alt="제품 상세 이미지 4"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 7가지 핵심 강점 - 미니멀 */}
      <div className="w-full py-16 px-20 bg-white">
        <div className="text-center mb-16">
          <h2
            className="text-2xl font-light text-gray-900 mb-2"
            style={{ letterSpacing: "-0.3px" }}
          >
            7가지 핵심 강점
          </h2>
          <div className="w-12 h-0.5 bg-gray-300 mx-auto mt-8"></div>
        </div>

        <div className="space-y-10">
          <div className="pb-8 border-b border-gray-100">
            <div className="mb-3">
              <span className="text-xs text-gray-400 tracking-widest">01</span>
            </div>
            <h3
              className="text-base font-medium text-gray-900 mb-3"
              style={{ letterSpacing: "-0.2px" }}
            >
              폭신한 다이아 퀼팅 소재
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              가벼운 착용감과 포근한 그립감을 제공하는 두툼한 핸들로, 장시간
              사용해도 손과 어깨가 전혀 피곤하지 않아요
            </p>
          </div>

          <div className="pb-8 border-b border-gray-100">
            <div className="mb-3">
              <span className="text-xs text-gray-400 tracking-widest">02</span>
            </div>
            <h3
              className="text-base font-medium text-gray-900 mb-3"
              style={{ letterSpacing: "-0.2px" }}
            >
              진주 리본 참 & 하트 펜던트
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              시선을 사로잡는 포인트 디자인! 탈부착이 가능해서 기분에 따라
              무드를 자유롭게 전환할 수 있어요
            </p>
          </div>

          <div className="pb-8 border-b border-gray-100">
            <div className="mb-3">
              <span className="text-xs text-gray-400 tracking-widest">03</span>
            </div>
            <h3
              className="text-base font-medium text-gray-900 mb-3"
              style={{ letterSpacing: "-0.2px" }}
            >
              미니멀한 스퀘어 실루엣
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              지갑, 파우치, 스마트폰, 소형 태블릿까지 일상 수납이 깔끔하게
              정리되는 완벽한 수납력
            </p>
          </div>

          <div className="pb-8 border-b border-gray-100">
            <div className="mb-3">
              <span className="text-xs text-gray-400 tracking-widest">04</span>
            </div>
            <h3
              className="text-base font-medium text-gray-900 mb-3"
              style={{ letterSpacing: "-0.2px" }}
            >
              D-링 금속 장식
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              고급스러운 마감으로 디테일까지 완벽! 참, 키링, 스트랩까지 다양하게
              확장 활용 가능해요
            </p>
          </div>

          <div className="pb-8 border-b border-gray-100">
            <div className="mb-3">
              <span className="text-xs text-gray-400 tracking-widest">05</span>
            </div>
            <h3
              className="text-base font-medium text-gray-900 mb-3"
              style={{ letterSpacing: "-0.2px" }}
            >
              블랙 컬러의 높은 코디력
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              은은한 광택이 더해진 블랙 컬러로 캐주얼부터 원피스까지 모든 룩에
              완벽하게 매치돼요
            </p>
          </div>

          <div className="pb-8 border-b border-gray-100">
            <div className="mb-3">
              <span className="text-xs text-gray-400 tracking-widest">06</span>
            </div>
            <h3
              className="text-base font-medium text-gray-900 mb-3"
              style={{ letterSpacing: "-0.2px" }}
            >
              내부 지퍼 보안
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              부드럽게 벌어지는 지퍼 상단으로 내용물이 안전하게 보호되어 분실
              걱정이 전혀 없어요
            </p>
          </div>

          <div className="pb-8">
            <div className="mb-3">
              <span className="text-xs text-gray-400 tracking-widest">07</span>
            </div>
            <h3
              className="text-base font-medium text-gray-900 mb-3"
              style={{ letterSpacing: "-0.2px" }}
            >
              꽃·리본 자수 포인트
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              러블리 무드를 더욱 강화하는 섬세한 자수 디테일로 선물용으로도
              만족도가 높아요
            </p>
          </div>
        </div>
      </div>

      {/* 제품 상세 이미지 5-6 */}
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (4)-Photoroom.png"
          alt="제품 상세 이미지 5"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_57PM (5)-Photoroom.png"
          alt="제품 상세 이미지 6"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 이 가방과 함께라면 */}
      <div className="w-full py-16 px-20 bg-white">
        <div className="text-center mb-12">
          <h2
            className="text-2xl font-light text-gray-900 mb-2"
            style={{ letterSpacing: "-0.3px" }}
          >
            이 가방과 함께라면
            <br />
            당신의 일상이 달라집니다
          </h2>
          <div className="w-12 h-0.5 bg-gray-300 mx-auto mt-8"></div>
        </div>

        <div className="space-y-8">
          <div className="text-center py-6 border-b border-gray-100">
            <h3 className="text-lg font-medium text-gray-900 mb-3">
              코디 완성도 상승
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              사진이나 거울샷에서 포인트가 되어 인스타그램 감성 업!
              <br />
              친구들에게 어디서 샀냐는 질문을 가장 많이 받는 아이템
            </p>
          </div>

          <div className="text-center py-6 border-b border-gray-100">
            <h3 className="text-lg font-medium text-gray-900 mb-3">
              피로감 감소
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              장시간 외출에도 손과 어깨가 편안해서
              <br />
              데이트, 쇼핑, 여행까지 하루 종일 활동해도 전혀 부담이 없어요
            </p>
          </div>

          <div className="text-center py-6">
            <h3 className="text-lg font-medium text-gray-900 mb-3">
              활용도 극대화
            </h3>
            <p
              className="text-sm text-gray-600 leading-relaxed"
              style={{ letterSpacing: "0.2px" }}
            >
              데일리, 데이트, 주말 나들이까지 한 개로 모든 상황을 커버!
              <br />
              가방 하나로 모든 코디가 완성되는 편리함
            </p>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-100">
          <p className="text-xs text-gray-500 tracking-widest mb-6 text-center">
            PERFECT FOR
          </p>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center py-4 bg-gray-50">
              <p className="text-sm text-gray-700">카페 데이트</p>
            </div>
            <div className="text-center py-4 bg-gray-50">
              <p className="text-sm text-gray-700">쇼핑</p>
            </div>
            <div className="text-center py-4 bg-gray-50">
              <p className="text-sm text-gray-700">캠퍼스 라이프</p>
            </div>
            <div className="text-center py-4 bg-gray-50">
              <p className="text-sm text-gray-700">출퇴근</p>
            </div>
          </div>
        </div>
      </div>

      {/* 제품 상세 이미지 7-8 */}
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 8_59PM-Photoroom.png"
          alt="제품 상세 이미지 7"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 9_02PM-Photoroom.png"
          alt="제품 상세 이미지 8"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 구매 프로세스 - 미니멀 */}
      <div className="w-full py-16 px-20 bg-white">
        <div className="text-center mb-16">
          <h2
            className="text-2xl font-light text-gray-900 mb-2"
            style={{ letterSpacing: "-0.3px" }}
          >
            구매는 간단하게, 3단계면 충분해요
          </h2>
          <div className="w-12 h-0.5 bg-gray-300 mx-auto mt-8"></div>
        </div>

        <div className="space-y-8">
          <div className="flex items-start gap-6 pb-8 border-b border-gray-100">
            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center border border-gray-300 text-gray-400 text-sm">
              01
            </div>
            <div>
              <h3 className="text-base font-medium text-gray-900 mb-2">
                색상 & 수량 선택
              </h3>
              <p className="text-sm text-gray-600">
                원하시는 색상과 수량을 선택하세요
              </p>
            </div>
          </div>

          <div className="flex items-start gap-6 pb-8 border-b border-gray-100">
            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center border border-gray-300 text-gray-400 text-sm">
              02
            </div>
            <div>
              <h3 className="text-base font-medium text-gray-900 mb-2">
                주문하기 클릭
              </h3>
              <p className="text-sm text-gray-600">
                장바구니 또는 바로구매 버튼을 클릭
              </p>
            </div>
          </div>

          <div className="flex items-start gap-6">
            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center border border-gray-300 text-gray-400 text-sm">
              03
            </div>
            <div>
              <h3 className="text-base font-medium text-gray-900 mb-2">
                빠른 배송
              </h3>
              <p className="text-sm text-gray-600">
                빠르고 안전하게 받아보세요
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-100">
          <p className="text-xs text-gray-500 tracking-widest mb-6 text-center">
            SAFE SHOPPING
          </p>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="py-4">
              <p className="text-xs text-gray-600">100% 정품 보증</p>
            </div>
            <div className="py-4">
              <p className="text-xs text-gray-600">7일 무료 반품</p>
            </div>
            <div className="py-4">
              <p className="text-xs text-gray-600">24시간 고객센터</p>
            </div>
            <div className="py-4">
              <p className="text-xs text-gray-600">안전한 결제</p>
            </div>
          </div>
        </div>
      </div>

      {/* 제품 상세 이미지 9-10 */}
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 9_03PM-Photoroom.png"
          alt="제품 상세 이미지 9"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>
      <div className="w-full bg-gray-50">
        <img
          src="/images/products/miniBag/Generated Image October 09, 2025 - 9_06PM-Photoroom.png"
          alt="제품 상세 이미지 10"
          className="w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* 상세 스펙 */}
      <div className="w-full py-16 px-20 bg-white">
        <div className="text-center mb-12">
          <h2
            className="text-2xl font-light text-gray-900 mb-2"
            style={{ letterSpacing: "-0.3px" }}
          >
            상세 정보
          </h2>
          <div className="w-12 h-0.5 bg-gray-300 mx-auto mt-8"></div>
        </div>

        <div className="space-y-10">
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-4 tracking-wide">
              제품 사양
            </h3>
            <div className="space-y-3">
              <div className="flex py-3 border-b border-gray-100">
                <span className="w-32 text-sm text-gray-500">소재</span>
                <span className="flex-1 text-sm text-gray-900">
                  폴리에스터 퀼팅 패브릭
                </span>
              </div>
              <div className="flex py-3 border-b border-gray-100">
                <span className="w-32 text-sm text-gray-500">색상</span>
                <span className="flex-1 text-sm text-gray-900">블랙</span>
              </div>
              <div className="flex py-3 border-b border-gray-100">
                <span className="w-32 text-sm text-gray-500">사이즈</span>
                <span className="flex-1 text-sm text-gray-900">
                  원사이즈 (스퀘어 미니)
                </span>
              </div>
              <div className="flex py-3">
                <span className="w-32 text-sm text-gray-500">무게</span>
                <span className="flex-1 text-sm text-gray-900">
                  약 250g (초경량)
                </span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-4 tracking-wide">
              사용 방법
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start text-sm text-gray-600">
                <span className="mr-2">·</span>
                <span>
                  진주 리본 참은 탈부착이 가능하므로 기분에 따라 연출하세요
                </span>
              </li>
              <li className="flex items-start text-sm text-gray-600">
                <span className="mr-2">·</span>
                <span>
                  내부 지퍼를 활용하여 소중한 물건을 안전하게 보관하세요
                </span>
              </li>
              <li className="flex items-start text-sm text-gray-600">
                <span className="mr-2">·</span>
                <span>
                  D-링에 키링이나 스트랩을 추가하여 나만의 스타일로 꾸며보세요
                </span>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-4 tracking-wide">
              주의사항
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start text-sm text-gray-600">
                <span className="mr-2">·</span>
                <span>
                  진주 리본 참은 강한 충격이나 걸림에 주의하고 필요 시 분리
                  보관하세요
                </span>
              </li>
              <li className="flex items-start text-sm text-gray-600">
                <span className="mr-2">·</span>
                <span>
                  금속 장식은 향수, 땀, 수분과 장시간 접촉 시 변색 가능—사용 후
                  마른 천으로 가볍게 닦아 보관
                </span>
              </li>
              <li className="flex items-start text-sm text-gray-600">
                <span className="mr-2">·</span>
                <span>
                  밝은 의류와 장시간 밀착 시 이염 우려가 있으니 초기 사용 시
                  주의하세요
                </span>
              </li>
              <li className="flex items-start text-sm text-gray-600">
                <span className="mr-2">·</span>
                <span>
                  형태 유지를 위해 과도한 적재를 금지하고, 사용하지 않을 때는
                  충전재를 넣어 보관하세요
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* 마지막 구매 촉구 - 미니멀 */}
      <div className="w-full py-20 bg-gray-900 text-center">
        <h2
          className="text-3xl font-light text-white mb-4"
          style={{ letterSpacing: "-0.5px" }}
        >
          지금이 아니면
          <br />이 가격에 만날 수 없어요
        </h2>
        <div className="w-16 h-0.5 bg-white mx-auto my-8"></div>
        <p className="text-lg text-gray-300 mb-10">
          오늘만 특별 할인 19% + 무료배송
        </p>

        <div className="max-w-md mx-auto space-y-4 text-sm text-gray-400">
          <p>재고 한정 | 1,247명이 이 상품을 보고 있습니다</p>
          <p>7일 무료 반품 · 100% 정품 보증 · 24시간 고객센터</p>
          <p className="pt-6 text-gray-500">
            ⭐ 154명의 고객이 이미 만족하고 계십니다 ⭐
          </p>
        </div>
      </div>

      {/* 푸터 정보 */}
      <div className="w-full py-12 bg-white text-center border-t border-gray-100">
        <p className="text-sm text-gray-600 mb-2">
          러블리 펄 리본 참 퀼팅 소프트 토트백 (블랙)
        </p>
        <p className="text-xs text-gray-500">
          고객센터: 1588-0000 | 평일 09:00-18:00 (주말/공휴일 휴무)
        </p>
      </div>
    </div>
  );
}
