"use client";

import { Button } from "@/components/ui/button";

export default function Hero() {
  const scrollToProducts = () => {
    const productsSection = document.getElementById("products");
    if (productsSection) {
      productsSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  const scrollToAbout = () => {
    const aboutSection = document.getElementById("about");
    if (aboutSection) {
      aboutSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section
      id="home"
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{
        backgroundImage: `url('https://readdy.ai/api/search-image?query=Minimalist%20handmade%20craft%20workspace%20with%20soft%20natural%20lighting%2C%20clean%20white%20background%2C%20delicate%20ribbons%20and%20fabric%20materials%20scattered%20artistically%2C%20pastel%20pink%20and%20lavender%20flowers%2C%20organized%20crafting%20tools%2C%20modern%20aesthetic%2C%20cozy%20atelier%20atmosphere%2C%20gentle%20shadows%2C%20professional%20photography%20style&width=1920&height=1080&seq=hero1&orientation=landscape')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="absolute inset-0 bg-white/60"></div>

      <div className="relative z-10 text-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center mb-6">
            <div className="w-6 h-6 flex items-center justify-center mr-3">
              <i className="ri-heart-line text-pink-400 text-xl"></i>
            </div>
            <h1
              className="text-5xl md:text-7xl font-bold text-gray-800"
              style={{ fontFamily: "var(--font-pacifico), serif" }}
            >
              Atelier Popo
            </h1>
            <div className="w-6 h-6 flex items-center justify-center ml-3">
              <i className="ri-flower-line text-pink-400 text-xl"></i>
            </div>
          </div>

          <p className="text-xl md:text-2xl text-gray-600 mb-8 font-light">
            손끝에서 피어나는 작은 행복들
          </p>

          <p className="text-lg text-gray-500 mb-12 max-w-2xl mx-auto leading-relaxed">
            정성스럽게 만든 핸드메이드 소품으로 여러분의 일상에 특별한 순간을
            선물합니다
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              onClick={scrollToProducts}
              variant="heroRounded"
              size="heroButton"
            >
              제품 둘러보기
            </Button>
            <Button
              onClick={scrollToAbout}
              variant="grayOutline"
              size="heroButton"
            >
              아틀리에 소개
            </Button>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
        <i className="ri-arrow-down-line text-gray-400 text-2xl"></i>
      </div>
    </section>
  );
}
