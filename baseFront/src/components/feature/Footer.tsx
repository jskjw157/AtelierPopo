
export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <h3 className="text-2xl font-bold mb-4" style={{ fontFamily: "Pacifico, serif" }}>
              Atelier Popo
            </h3>
            <p className="text-gray-300 mb-6 leading-relaxed">
              정성스럽게 만든 핸드메이드 소품으로 여러분의 일상에 특별한 순간을 선물합니다. 
              하나하나 손으로 만드는 따뜻함을 전해드려요.
            </p>
            <div className="flex space-x-4">
              <a href="#" className="w-10 h-10 bg-pink-500 hover:bg-pink-600 rounded-full flex items-center justify-center transition-colors">
                <i className="ri-instagram-line text-lg"></i>
              </a>
              <a href="#" className="w-10 h-10 bg-pink-500 hover:bg-pink-600 rounded-full flex items-center justify-center transition-colors">
                <i className="ri-kakao-talk-fill text-lg"></i>
              </a>
              <a href="#" className="w-10 h-10 bg-pink-500 hover:bg-pink-600 rounded-full flex items-center justify-center transition-colors">
                <i className="ri-mail-line text-lg"></i>
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">카테고리</h4>
            <ul className="space-y-3">
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">에코백</a></li>
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">미니백</a></li>
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">파우치</a></li>
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">베이비소품</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">고객센터</h4>
            <ul className="space-y-3">
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">주문/배송 문의</a></li>
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">교환/환불</a></li>
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">맞춤 제작</a></li>
              <li><a href="#" className="text-gray-300 hover:text-white transition-colors">FAQ</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-400 mb-4 md:mb-0">
            © 2024 Atelier Popo. All rights reserved.
          </p>
          <div className="flex items-center space-x-4">
            <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">이용약관</a>
            <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">개인정보처리방침</a>
            <a href="https://readdy.ai/?origin=logo" className="text-gray-400 hover:text-white transition-colors text-sm">Website Builder</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
