
import { useState, useEffect } from 'react';
import Header from '../../components/feature/Header';
import Footer from '../../components/feature/Footer';

interface CartItem {
  id: number;
  name: string;
  price: string;
  image: string;
  quantity: number;
  color?: string;
  size?: string;
}

interface OrderForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  detailAddress: string;
  zipCode: string;
  paymentMethod: string;
  memo: string;
}

export default function Checkout() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderForm, setOrderForm] = useState<OrderForm>({
    name: '',
    email: '',
    phone: '',
    address: '',
    detailAddress: '',
    zipCode: '',
    paymentMethod: 'card',
    memo: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  useEffect(() => {
    // 장바구니 데이터 불러오기
    const savedCart = localStorage.getItem('cart');
    if (savedCart) {
      setCartItems(JSON.parse(savedCart));
    } else {
      // 장바구니가 비어있으면 제품 페이지로 리다이렉트
      window.REACT_APP_NAVIGATE?.('/products') ?? window.location.assign('/products');
    }
  }, []);

  const getTotalPrice = () => {
    return cartItems.reduce((total, item) => {
      const price = parseInt(item.price.replace(/[^0-9]/g, ''), 10);
      return total + (price * item.quantity);
    }, 0);
  };

  const getShippingFee = () => {
    const total = getTotalPrice();
    return total >= 50000 ? 0 : 3000; // 5만원 이상 무료배송
  };

  const getFinalTotal = () => {
    return getTotalPrice() + getShippingFee();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setOrderForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 필수 필드 검증
    if (!orderForm.name || !orderForm.email || !orderForm.phone || !orderForm.address) {
      alert('필수 정보를 모두 입력해주세요.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 실제로는 여기서 서버에 주문 데이터를 전송
      await new Promise(resolve => setTimeout(resolve, 2000)); // 시뮬레이션

      // 주문 완료 후 장바구니 비우기
      localStorage.removeItem('cart');
      window.dispatchEvent(new Event('cartUpdated'));

      setShowSuccessModal(true);
    } catch (error) {
      alert('주문 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    setShowSuccessModal(false);
    window.REACT_APP_NAVIGATE?.('/') ?? window.location.assign('/');
  };

  if (cartItems.length === 0 && !showSuccessModal) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <i className="ri-shopping-bag-line text-gray-300 text-4xl mb-4"></i>
          <p className="text-gray-500 mb-4">장바구니가 비어있습니다</p>
          <button
            onClick={() => window.REACT_APP_NAVIGATE?.('/products') ?? window.location.assign('/products')}
            className="bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap cursor-pointer"
          >
            쇼핑하러 가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "Inter, sans-serif" }}>
      <Header />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 페이지 제목 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">주문/결제</h1>
          <p className="text-gray-600 mt-2">주문 정보를 확인하고 결제를 진행해주세요.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 주문 정보 입력 */}
          <div className="lg:col-span-2">
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* 주문자 정보 */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">주문자 정보</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">이름 *</label>
                    <input
                      type="text"
                      name="name"
                      value={orderForm.name}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                      placeholder="이름을 입력해주세요"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">이메일 *</label>
                    <input
                      type="email"
                      name="email"
                      value={orderForm.email}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                      placeholder="이메일을 입력해주세요"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">연락처 *</label>
                    <input
                      type="tel"
                      name="phone"
                      value={orderForm.phone}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                      placeholder="연락처를 입력해주세요"
                    />
                  </div>
                </div>
              </div>

              {/* 배송 정보 */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">배송 정보</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">우편번호</label>
                      <input
                        type="text"
                        name="zipCode"
                        value={orderForm.zipCode}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                        placeholder="우편번호"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">주소 *</label>
                      <input
                        type="text"
                        name="address"
                        value={orderForm.address}
                        onChange={handleInputChange}
                        required
                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                        placeholder="주소를 입력해주세요"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">상세주소</label>
                    <input
                      type="text"
                      name="detailAddress"
                      value={orderForm.detailAddress}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                      placeholder="상세주소를 입력해주세요"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">배송 메모</label>
                    <textarea
                      name="memo"
                      value={orderForm.memo}
                      onChange={handleInputChange}
                      rows={3}
                      maxLength={500}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm resize-none"
                      placeholder="배송 시 요청사항이 있으시면 입력해주세요 (최대 500자)"
                    />
                    <p className="text-xs text-gray-500 mt-1">{orderForm.memo.length}/500자</p>
                  </div>
                </div>
              </div>

              {/* 결제 방법 */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">결제 방법</h2>
                <div className="space-y-3">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="card"
                      checked={orderForm.paymentMethod === 'card'}
                      onChange={handleInputChange}
                      className="w-4 h-4 text-pink-500 focus:ring-pink-500"
                    />
                    <span className="text-gray-700">신용카드</span>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="bank"
                      checked={orderForm.paymentMethod === 'bank'}
                      onChange={handleInputChange}
                      className="w-4 h-4 text-pink-500 focus:ring-pink-500"
                    />
                    <span className="text-gray-700">무통장입금</span>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="kakao"
                      checked={orderForm.paymentMethod === 'kakao'}
                      onChange={handleInputChange}
                      className="w-4 h-4 text-pink-500 focus:ring-pink-500"
                    />
                    <span className="text-gray-700">카카오페이</span>
                  </label>
                </div>
              </div>
            </form>
          </div>

          {/* 주문 요약 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl p-6 shadow-sm sticky top-24">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">주문 요약</h2>
              
              {/* 주문 상품 목록 */}
              <div className="space-y-4 mb-6">
                {cartItems.map((item) => (
                  <div key={`${item.id}-${item.color}-${item.size}`} className="flex items-center space-x-3">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-12 h-12 object-cover object-top rounded-lg"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">{item.name}</h3>
                      {item.color && (
                        <p className="text-xs text-gray-500">색상: {item.color}</p>
                      )}
                      {item.size && (
                        <p className="text-xs text-gray-500">사이즈: {item.size}</p>
                      )}
                      <p className="text-sm font-medium text-gray-900">
                        {item.price} × {item.quantity}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 가격 요약 */}
              <div className="border-t border-gray-200 pt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">상품금액</span>
                  <span className="text-gray-900">{getTotalPrice().toLocaleString()}원</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">배송비</span>
                  <span className="text-gray-900">
                    {getShippingFee() === 0 ? '무료' : `${getShippingFee().toLocaleString()}원`}
                  </span>
                </div>
                <div className="border-t border-gray-200 pt-3">
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-gray-900">총 결제금액</span>
                    <span className="text-pink-600">{getFinalTotal().toLocaleString()}원</span>
                  </div>
                </div>
              </div>

              {/* 배송 안내 */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-sm font-medium text-gray-900 mb-2">배송 안내</h3>
                <ul className="text-xs text-gray-600 space-y-1">
                  <li>• 5만원 이상 주문 시 무료배송</li>
                  <li>• 평일 오후 2시 이전 주문 시 당일발송</li>
                  <li>• 배송기간: 1-3일 (주말/공휴일 제외)</li>
                </ul>
              </div>

              {/* 주문하기 버튼 */}
              <button
                type="submit"
                form="checkout-form"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full bg-pink-500 hover:bg-pink-600 disabled:bg-gray-300 text-white py-4 rounded-lg font-semibold text-lg transition-all duration-200 whitespace-nowrap cursor-pointer mt-6"
              >
                {isSubmitting ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>주문 처리중...</span>
                  </div>
                ) : (
                  `${getFinalTotal().toLocaleString()}원 결제하기`
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 주문 완료 모달 */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black bg-opacity-50"></div>
          
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-xl">
              <div className="text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <i className="ri-check-line text-green-500 text-3xl"></i>
                </div>
                
                <h3 className="text-2xl font-bold text-gray-900 mb-4">주문이 완료되었습니다!</h3>
                <p className="text-gray-600 mb-6">
                  주문해주셔서 감사합니다.<br />
                  주문 확인 메일을 발송해드렸습니다.
                </p>
                
                <div className="bg-gray-50 rounded-lg p-4 mb-6">
                  <p className="text-sm text-gray-600 mb-2">주문번호</p>
                  <p className="font-mono text-lg font-semibold text-gray-900">
                    #{Date.now().toString().slice(-8)}
                  </p>
                </div>
                
                <button
                  onClick={handleSuccessClose}
                  className="w-full bg-pink-500 hover:bg-pink-600 text-white py-3 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap cursor-pointer"
                >
                  홈으로 돌아가기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
