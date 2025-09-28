'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

interface OrderItem {
  id: number;
  name: string;
  price: string;
  image: string;
  quantity: number;
  orderDate: string;
  status: string;
}

export default function MyPage() {
  const [activeTab, setActiveTab] = useState('profile');
  const [orderHistory, setOrderHistory] = useState<OrderItem[]>([]);
  const [userInfo, setUserInfo] = useState({
    name: '김민지',
    email: 'minji.kim@email.com',
    phone: '010-1234-5678',
    address: '서울시 강남구 테헤란로 123',
    joinDate: '2023.03.15'
  });
  const router = useRouter();

  useEffect(() => {
    // 주문 내역 로드 (실제로는 API에서 가져올 데이터)
    const mockOrders: OrderItem[] = [
      {
        id: 1,
        name: "블루밍 에코백",
        price: "28,000원",
        image: "https://readdy.ai/api/search-image?query=Handmade%20cotton%20eco%20bag%20with%20delicate%20floral%20embroidery%2C%20pastel%20blue%20and%20pink%20colors%2C%20minimalist%20design%2C%20clean%20white%20background%2C%20soft%20lighting%2C%20detailed%20stitching%20visible%2C%20artisan%20craftsmanship%2C%20Korean%20style%20aesthetic%2C%20professional%20product%20photography&width=300&height=300&seq=order1&orientation=squarish",
        quantity: 1,
        orderDate: "2024.01.15",
        status: "배송완료"
      },
      {
        id: 2,
        name: "러블리 미니파우치",
        price: "15,000원",
        image: "https://readdy.ai/api/search-image?query=Small%20handmade%20fabric%20pouch%20with%20heart%20pattern%2C%20soft%20pink%20and%20cream%20colors%2C%20ribbon%20details%2C%20clean%20white%20background%2C%20minimalist%20styling%2C%20Korean%20handcraft%20aesthetic%2C%20delicate%20embroidery%2C%20professional%20product%20photography&width=300&height=300&seq=order2&orientation=squarish",
        quantity: 2,
        orderDate: "2024.01.08",
        status: "배송중"
      },
      {
        id: 3,
        name: "데일리 캔버스백",
        price: "35,000원",
        image: "https://readdy.ai/api/search-image?query=Canvas%20daily%20bag%20handmade%20with%20natural%20beige%20color%2C%20simple%20minimal%20design%2C%20leather%20handles%2C%20clean%20white%20background%2C%20professional%20product%20photography%2C%20Korean%20style%20craftsmanship%2C%20soft%20shadows&width=300&height=300&seq=order3&orientation=squarish",
        quantity: 1,
        orderDate: "2023.12.28",
        status: "배송완료"
      }
    ];
    setOrderHistory(mockOrders);
  }, []);

  const handleProfileUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    alert('프로필이 업데이트되었습니다.');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case '배송완료':
        return 'text-green-600 bg-green-50';
      case '배송중':
        return 'text-blue-600 bg-blue-50';
      case '주문확인':
        return 'text-orange-600 bg-orange-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
      <Header />

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-pink-50 to-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-4">마이페이지</h1>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            회원정보와 주문내역을 확인하고 관리하세요
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar */}
            <div className="lg:w-1/4">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="text-center mb-6">
                  <div className="w-20 h-20 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i className="ri-user-line text-3xl text-pink-500"></i>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800">{userInfo.name}</h3>
                  <p className="text-gray-500 text-sm">{userInfo.email}</p>
                </div>
                
                <nav className="space-y-2">
                  <button
                    onClick={() => setActiveTab('profile')}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                      activeTab === 'profile'
                        ? 'bg-pink-50 text-pink-600 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <i className="ri-user-line mr-3"></i>
                    회원정보
                  </button>
                  <button
                    onClick={() => setActiveTab('orders')}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                      activeTab === 'orders'
                        ? 'bg-pink-50 text-pink-600 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <i className="ri-shopping-bag-line mr-3"></i>
                    주문내역
                  </button>
                  <button
                    onClick={() => setActiveTab('wishlist')}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                      activeTab === 'wishlist'
                        ? 'bg-pink-50 text-pink-600 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <i className="ri-heart-line mr-3"></i>
                    찜한상품
                  </button>
                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                      activeTab === 'settings'
                        ? 'bg-pink-50 text-pink-600 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <i className="ri-settings-line mr-3"></i>
                    설정
                  </button>
                </nav>
              </div>
            </div>

            {/* Content */}
            <div className="lg:w-3/4">
              {/* Profile Tab */}
              {activeTab === 'profile' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                  <h2 className="text-2xl font-bold text-gray-800 mb-6">회원정보</h2>
                  
                  <form onSubmit={handleProfileUpdate} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">이름</label>
                        <input
                          type="text"
                          value={userInfo.name}
                          onChange={(e) => setUserInfo({...userInfo, name: e.target.value})}
                          className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">이메일</label>
                        <input
                          type="email"
                          value={userInfo.email}
                          onChange={(e) => setUserInfo({...userInfo, email: e.target.value})}
                          className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">전화번호</label>
                        <input
                          type="tel"
                          value={userInfo.phone}
                          onChange={(e) => setUserInfo({...userInfo, phone: e.target.value})}
                          className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">가입일</label>
                        <input
                          type="text"
                          value={userInfo.joinDate}
                          disabled
                          className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">주소</label>
                      <input
                        type="text"
                        value={userInfo.address}
                        onChange={(e) => setUserInfo({...userInfo, address: e.target.value})}
                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="bg-pink-500 hover:bg-pink-600 text-white px-8 py-3 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer"
                      >
                        정보 수정
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Orders Tab */}
              {activeTab === 'orders' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                  <h2 className="text-2xl font-bold text-gray-800 mb-6">주문내역</h2>
                  
                  {orderHistory.length > 0 ? (
                    <div className="space-y-4">
                      {orderHistory.map((order) => (
                        <div key={order.id} className="border border-gray-200 rounded-lg p-6">
                          <div className="flex flex-col md:flex-row gap-4">
                            <div className="w-24 h-24 flex-shrink-0">
                              <img
                                src={order.image}
                                alt={order.name}
                                className="w-full h-full object-cover object-top rounded-lg"
                              />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-start mb-2">
                                <h3 className="text-lg font-semibold text-gray-800">{order.name}</h3>
                                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(order.status)}`}>
                                  {order.status}
                                </span>
                              </div>
                              <p className="text-gray-600 mb-2">수량: {order.quantity}개</p>
                              <p className="text-lg font-bold text-gray-900 mb-2">{order.price}</p>
                              <p className="text-sm text-gray-500">주문일: {order.orderDate}</p>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button className="px-4 py-2 border border-pink-500 text-pink-500 hover:bg-pink-50 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer">
                                상세보기
                              </button>
                              <button className="px-4 py-2 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer">
                                재주문
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16">
                      <i className="ri-shopping-bag-line text-gray-300 text-4xl mb-4"></i>
                      <p className="text-gray-500">주문 내역이 없습니다.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Wishlist Tab */}
              {activeTab === 'wishlist' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                  <h2 className="text-2xl font-bold text-gray-800 mb-6">찜한상품</h2>
                  
                  <div className="text-center py-16">
                    <i className="ri-heart-line text-gray-300 text-4xl mb-4"></i>
                    <p className="text-gray-500">찜한 상품이 없습니다.</p>
                    <button 
                      onClick={() => router.push('/products')}
                      className="mt-4 bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer"
                    >
                      상품 둘러보기
                    </button>
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                  <h2 className="text-2xl font-bold text-gray-800 mb-6">설정</h2>
                  
                  <div className="space-y-6">
                    <div className="border-b border-gray-200 pb-6">
                      <h3 className="text-lg font-semibold text-gray-800 mb-4">알림 설정</h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700">주문 상태 알림</span>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" defaultChecked />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-pink-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                          </label>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700">신상품 알림</span>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-pink-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                          </label>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700">이벤트 알림</span>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" defaultChecked />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-pink-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                          </label>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-b border-gray-200 pb-6">
                      <h3 className="text-lg font-semibold text-gray-800 mb-4">계정 관리</h3>
                      <div className="space-y-3">
                        <button className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer">
                          비밀번호 변경
                        </button>
                        <button className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer">
                          개인정보 처리방침
                        </button>
                        <button className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer">
                          이용약관
                        </button>
                      </div>
                    </div>
                    
                    <div>
                      <button className="text-red-500 hover:text-red-600 font-medium cursor-pointer">
                        회원탈퇴
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
