"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSocialLogin = (provider: string) => {
    setIsLoading(true);
    // 실제 소셜 로그인 구현 시 여기에 로직 추가
    console.log(`${provider} 로그인 시도`);

    // 임시로 2초 후 로딩 해제 (실제로는 소셜 로그인 완료 후)
    setTimeout(() => {
      setIsLoading(false);
      alert(`${provider} 로그인이 구현되면 여기서 처리됩니다.`);
    }, 2000);
  };

  return (
    <div
      className="min-h-screen bg-white"
      style={{ fontFamily: "var(--font-inter), sans-serif" }}
    >
      <Header />

      {/* Main Content */}
      <section className="py-16 min-h-screen flex items-center">
        <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
            {/* Logo */}
            <div className="text-center mb-8">
              <h1
                className="text-3xl font-bold text-gray-800 mb-2"
                style={{ fontFamily: "var(--font-pacifico), serif" }}
              >
                Atelier Popo
              </h1>
              <p className="text-gray-600">
                간편하게 로그인하고 쇼핑을 시작하세요
              </p>
            </div>

            {/* Social Login Buttons */}
            <div className="space-y-4">
              {/* Google Login */}
              <button
                onClick={() => handleSocialLogin("Google")}
                disabled={isLoading}
                className="w-full flex items-center justify-center px-6 py-3 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <div className="w-5 h-5 mr-3 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                </div>
                Google로 로그인
              </button>

              {/* Kakao Login */}
              <button
                onClick={() => handleSocialLogin("Kakao")}
                disabled={isLoading}
                className="w-full flex items-center justify-center px-6 py-3 rounded-lg text-gray-900 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                style={{ backgroundColor: "#FEE500" }}
              >
                <div className="w-5 h-5 mr-3 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#000000">
                    <path d="M12 3C7.03 3 3 6.14 3 10.1c0 2.52 1.65 4.74 4.1 6.05l-.96 3.52c-.08.3.23.56.5.42l4.28-2.83c.36.04.72.06 1.08.06 4.97 0 9-3.14 9-7.1S16.97 3 12 3z" />
                  </svg>
                </div>
                카카오로 로그인
              </button>

              {/* Naver Login */}
              <button
                onClick={() => handleSocialLogin("Naver")}
                disabled={isLoading}
                className="w-full flex items-center justify-center px-6 py-3 rounded-lg text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                style={{ backgroundColor: "#03C75A" }}
              >
                <div className="w-5 h-5 mr-3 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white">
                    <path d="M16.273 12.845 7.376 0H0v24h7.726V11.156L16.624 24H24V0h-7.727v12.845z" />
                  </svg>
                </div>
                네이버로 로그인
              </button>

              {/* Apple Login */}
              <button
                onClick={() => handleSocialLogin("Apple")}
                disabled={isLoading}
                className="w-full flex items-center justify-center px-6 py-3 rounded-lg text-white bg-black hover:bg-gray-800 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <div className="w-5 h-5 mr-3 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>
                </div>
                Apple로 로그인
              </button>
            </div>

            {/* Loading State */}
            {isLoading && (
              <div className="mt-6 text-center">
                <div className="inline-flex items-center px-4 py-2 text-sm text-gray-600">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-4 w-4 text-gray-600"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  로그인 중...
                </div>
              </div>
            )}

            {/* Terms */}
            <div className="mt-8 text-center text-sm text-gray-500">
              <p>
                로그인하면{" "}
                <button className="text-pink-500 hover:underline cursor-pointer">
                  이용약관
                </button>{" "}
                및{" "}
                <button className="text-pink-500 hover:underline cursor-pointer">
                  개인정보처리방침
                </button>
                에 동의하는 것으로 간주됩니다.
              </p>
            </div>

            {/* Guest Shopping */}
            <div className="mt-6 text-center">
              <button
                onClick={() => router.push("/products")}
                className="text-gray-600 hover:text-gray-800 text-sm underline cursor-pointer"
              >
                로그인 없이 둘러보기
              </button>
            </div>
          </div>

          {/* Additional Info */}
          <div className="mt-8 text-center">
            <div className="bg-pink-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">
                소셜 로그인의 장점
              </h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• 간편하고 빠른 로그인</li>
                <li>• 별도 회원가입 불필요</li>
                <li>• 안전한 개인정보 보호</li>
                <li>• 주문내역 및 찜한상품 관리</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
