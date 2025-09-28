"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Cart from "../feature/Cart";
import SearchModal from "../feature/SearchModal";
import { useCart } from "@/hooks/useCart";

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const { cartItemCount } = useCart();

  const handleNavigation = (path: string) => {
    if (path.startsWith("#")) {
      // 앵커 링크인 경우 현재 페이지에서 스크롤
      if (pathname === "/") {
        const element = document.querySelector(path);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      } else {
        // 다른 페이지에 있다면 홈으로 이동 후 스크롤
        router.push("/");
        setTimeout(() => {
          const element = document.querySelector(path);
          if (element) {
            element.scrollIntoView({ behavior: "smooth" });
          }
        }, 100);
      }
    } else {
      // 일반 경로인 경우
      router.push(path);
    }
    setIsMenuOpen(false);
  };

  return (
    <>
      <header className="bg-white/95 backdrop-blur-sm sticky top-0 z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1
                className="text-2xl font-bold cursor-pointer"
                style={{ fontFamily: "var(--font-pacifico), serif" }}
                onClick={() => handleNavigation("/")}
              >
                Atelier Popo
              </h1>
            </div>

            <nav className="hidden md:flex space-x-8">
              <button
                onClick={() => handleNavigation("#home")}
                className="text-gray-700 hover:text-pink-500 transition-colors font-medium cursor-pointer"
              >
                홈
              </button>
              <button
                onClick={() => handleNavigation("/products")}
                className="text-gray-700 hover:text-pink-500 transition-colors font-medium cursor-pointer"
              >
                제품
              </button>
              <button
                onClick={() => handleNavigation("#about")}
                className="text-gray-700 hover:text-pink-500 transition-colors font-medium cursor-pointer"
              >
                소개
              </button>
              <button
                onClick={() => handleNavigation("#gallery")}
                className="text-gray-700 hover:text-pink-500 transition-colors font-medium cursor-pointer"
              >
                갤러리
              </button>
              <button
                onClick={() => handleNavigation("/contact")}
                className="text-gray-700 hover:text-pink-500 transition-colors font-medium cursor-pointer"
              >
                문의
              </button>
            </nav>

            <div className="hidden md:flex items-center space-x-4">
              <button
                onClick={() => setIsSearchOpen(true)}
                className="p-2 text-gray-700 hover:text-pink-500 transition-colors cursor-pointer"
              >
                <i className="ri-search-line text-lg"></i>
              </button>
              <button
                onClick={() => setIsCartOpen(true)}
                className="p-2 text-gray-700 hover:text-pink-500 transition-colors cursor-pointer relative"
              >
                <i className="ri-shopping-bag-line text-lg"></i>
                {cartItemCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-pink-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                    {cartItemCount > 99 ? "99+" : cartItemCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => handleNavigation("/login")}
                className="p-2 text-gray-700 hover:text-pink-500 transition-colors cursor-pointer"
              >
                <i className="ri-user-line text-lg"></i>
              </button>
            </div>

            <button
              className="md:hidden p-2 text-gray-700 cursor-pointer"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              <i
                className={`ri-${isMenuOpen ? "close" : "menu"}-line text-xl`}
              ></i>
            </button>
          </div>

          {isMenuOpen && (
            <div className="md:hidden py-4 border-t border-gray-100">
              <nav className="flex flex-col space-y-4">
                <button
                  onClick={() => handleNavigation("#home")}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer"
                >
                  홈
                </button>
                <button
                  onClick={() => handleNavigation("/products")}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer"
                >
                  제품
                </button>
                <button
                  onClick={() => handleNavigation("#about")}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer"
                >
                  소개
                </button>
                <button
                  onClick={() => handleNavigation("#gallery")}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer"
                >
                  갤러리
                </button>
                <button
                  onClick={() => handleNavigation("/contact")}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer"
                >
                  문의
                </button>
                <button
                  onClick={() => {
                    setIsSearchOpen(true);
                    setIsMenuOpen(false);
                  }}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer flex items-center space-x-2"
                >
                  <i className="ri-search-line"></i>
                  <span>검색</span>
                </button>
                <button
                  onClick={() => {
                    setIsCartOpen(true);
                    setIsMenuOpen(false);
                  }}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer flex items-center space-x-2"
                >
                  <i className="ri-shopping-bag-line"></i>
                  <span>장바구니 ({cartItemCount})</span>
                </button>
                <button
                  onClick={() => handleNavigation("/login")}
                  className="text-gray-700 hover:text-pink-500 transition-colors font-medium text-left cursor-pointer flex items-center space-x-2"
                >
                  <i className="ri-user-line"></i>
                  <span>로그인</span>
                </button>
              </nav>
            </div>
          )}
        </div>
      </header>

      <Cart isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </>
  );
}
