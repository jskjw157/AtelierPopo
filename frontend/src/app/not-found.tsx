import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '페이지를 찾을 수 없습니다 - Atelier Popo',
  description: '요청하신 페이지를 찾을 수 없습니다.',
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
      <Header />
      
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="max-w-md mx-auto">
          <div className="mb-8">
            <h1 className="text-6xl md:text-8xl font-bold text-gray-200 mb-4">404</h1>
            <h2 className="text-2xl md:text-3xl font-semibold text-gray-800 mb-4">
              페이지를 찾을 수 없습니다
            </h2>
            <p className="text-lg text-gray-600 mb-8">
              요청하신 페이지가 존재하지 않거나 이동되었을 수 있습니다.
            </p>
          </div>
          
          <div className="space-y-4">
            <a
              href="/"
              className="inline-block bg-pink-500 hover:bg-pink-600 text-white px-8 py-3 rounded-lg font-medium transition-colors duration-200"
            >
              홈으로 돌아가기
            </a>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/products"
                className="text-pink-500 hover:text-pink-600 font-medium transition-colors duration-200"
              >
                제품 둘러보기
              </a>
              <a
                href="/contact"
                className="text-pink-500 hover:text-pink-600 font-medium transition-colors duration-200"
              >
                문의하기
              </a>
            </div>
          </div>
        </div>
      </div>
      
      <Footer />
    </div>
  );
}
