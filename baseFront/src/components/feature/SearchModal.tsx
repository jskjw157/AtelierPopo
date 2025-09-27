
import { useState, useEffect } from 'react';

const allProducts = [
  {
    id: 1,
    name: "블루밍 에코백",
    price: "28,000원",
    image: "https://readdy.ai/api/search-image?query=Handmade%20cotton%20eco%20bag%20with%20delicate%20floral%20embroidery%2C%20pastel%20blue%20and%20pink%20colors%2C%20minimalist%20design%2C%20clean%20white%20background%2C%20soft%20lighting%2C%20detailed%20stitching%20visible%2C%20artisan%20craftsmanship%2C%20Korean%20style%20aesthetic%2C%20professional%20product%20photography&width=400&height=400&seq=eco1&orientation=squarish",
    category: "에코백"
  },
  {
    id: 2,
    name: "러블리 미니파우치",
    price: "15,000원",
    image: "https://readdy.ai/api/search-image?query=Small%20handmade%20fabric%20pouch%20with%20heart%20pattern%2C%20soft%20pink%20and%20cream%20colors%2C%20ribbon%20details%2C%20clean%20white%20background%2C%20minimalist%20styling%2C%20Korean%20handcraft%20aesthetic%2C%20delicate%20embroidery%2C%20professional%20product%20photography&width=400&height=400&seq=pouch1&orientation=squarish",
    category: "파우치"
  },
  {
    id: 3,
    name: "데일리 캔버스백",
    price: "35,000원",
    image: "https://readdy.ai/api/search-image?query=Canvas%20daily%20bag%20handmade%20with%20natural%20beige%20color%2C%20simple%20minimal%20design%2C%20leather%20handles%2C%20clean%20white%20background%2C%20professional%20product%20photography%2C%20Korean%20style%20craftsmanship%2C%20soft%20shadows&width=400&height=400&seq=daily1&orientation=squarish",
    category: "데일리백"
  },
  {
    id: 4,
    name: "플라워 곱창밴드",
    price: "8,000원",
    image: "https://readdy.ai/api/search-image?query=Handmade%20fabric%20hair%20scrunchie%20with%20small%20flower%20print%2C%20pastel%20colors%2C%20delicate%20pattern%2C%20clean%20white%20background%2C%20Korean%20style%20hair%20accessory%2C%20soft%20cotton%20material%2C%20professional%20product%20photography&width=400&height=400&seq=band1&orientation=squarish",
    category: "헤어밴드"
  },
  {
    id: 5,
    name: "베이비 기저귀파우치",
    price: "22,000원",
    image: "https://readdy.ai/api/search-image?query=Baby%20diaper%20pouch%20handmade%20with%20soft%20pastel%20colors%2C%20cute%20animal%20motifs%2C%20clean%20white%20background%2C%20organized%20compartments%2C%20Korean%20style%20baby%20accessory%20gentle%20colors%2C%20professional%20product%20photography&width=400&height=400&seq=baby1&orientation=squarish",
    category: "베이비소품"
  },
  {
    id: 6,
    name: "스위트 미니백",
    price: "32,000원",
    image: "https://readdy.ai/api/search-image?query=Small%20handmade%20bag%20with%20bow%20detail%2C%20pastel%20pink%20color%2C%20minimalist%20design%20clean%20white%20background%20Korean%20style%20craftsmanship%20delicate%20stitching%20professional%20product%20photography&width=400&height=400&seq=mini1&orientation=squarish",
    category: "미니백"
  },
  {
    id: 7,
    name: "로맨틱 크로스백",
    price: "42,000원",
    image: "https://readdy.ai/api/search-image?query=Romantic%20crossbody%20bag%20handmade%20with%20soft%20fabric%2C%20pastel%20colors%2C%20delicate%20lace%20details%2C%20clean%20white%20background%2C%20Korean%20style%20fashion%20accessory%20professional%20product%20photography&width=400&height=400&seq=cross1&orientation=squarish",
    category: "크로스백"
  },
  {
    id: 8,
    name: "큐티 동전지갑",
    price: "12,000원",
    image: "https://readdy.ai/api/search-image?query=Small%20cute%20coin%20purse%20handmade%20with%20cartoon%20characters%2C%20bright%20colors%2C%20clean%20white%20background%20Korean%20style%20small%20accessory%20professional%20product%20photography&width=400&height=400&seq=coin1&orientation=squarish",
    category: "지갑"
  },
  {
    id: 9,
    name: "프린세스 헤어핀",
    price: "6,000원",
    image: "https://readdy.ai/api/search-image?query=Princess%20style%20handmade%20hair%20pins%20with%20pearl%20and%20ribbon%20details%2C%20pastel%20colors%2C%20clean%20white%20background%2C%20Korean%20style%20hair%20accessory%20delicate%20craftsmanship%20professional%20product%20photography&width=400&height=400&seq=pin1&orientation=squarish",
    category: "헤어핀"
  },
  {
    id: 10,
    name: "빈티지 숄더백",
    price: "38,000원",
    image: "https://readdy.ai/api/search-image?query=Vintage%20style%20shoulder%20bag%20handmade%20with%20natural%20linen%20fabric%2C%20neutral%20colors%2C%20clean%20white%20background%2C%20Korean%20style%20craftsmanship%20professional%20product%20photography&width=400&height=400&seq=shoulder1&orientation=squarish",
    category: "숄더백"
  },
  {
    id: 11,
    name: "스마일 키링",
    price: "9,000원",
    image: "https://readdy.ai/api/search-image?query=Smile%20face%20keychain%20handmade%20with%20colorful%20felt%20fabric%2C%20cute%20design%2C%20clean%20white%20background%2C%20Korean%20style%20small%20accessory%20professional%20product%20photography&width=400&height=400&seq=key1&orientation=squarish",
    category: "키링"
  },
  {
    id: 12,
    name: "엘레강스 클루시",
    price: "45,000원",
    image: "https://readdy.ai/api/search-image?query=Elegant%20clutch%20bag%20handmade%20with%20silk%20fabric%2C%20sophisticated%20design%20clean%20white%20background%20Korean%20style%20luxury%20accessory%20professional%20product%20photography&width=400&height=400&seq=clutch1&orientation=squarish",
    category: "클러치"
  }
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(allProducts);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults(allProducts);
    } else {
      const filtered = allProducts.filter(product =>
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setSearchResults(filtered);
    }
  }, [searchQuery]);

  const handleProductClick = (productId: number) => {
    onClose();
    if (window.REACT_APP_NAVIGATE) {
      window.REACT_APP_NAVIGATE(`/product-detail?id=${productId}`);
    } else {
      window.location.href = `/product-detail?id=${productId}`;
    }
  };

  const addToCart = (product: any, event: React.MouseEvent) => {
    event.stopPropagation();
    
    const cartItem = {
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity: 1,
      color: "",
      size: ""
    };

    let existingCart = [];
    try {
      const stored = localStorage.getItem('cart');
      existingCart = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(existingCart)) {
        existingCart = [];
      }
    } catch (e) {
      existingCart = [];
    }

    const existingItemIndex = existingCart.findIndex(
      (item: any) => item.id === cartItem.id
    );

    if (existingItemIndex > -1) {
      existingCart[existingItemIndex].quantity += 1;
    } else {
      existingCart.push(cartItem);
    }

    try {
      localStorage.setItem('cart', JSON.stringify(existingCart));
      window.dispatchEvent(new Event('cartUpdated'));
    } catch (e) {
      console.error('Failed to write cart to localStorage:', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
      
      <div className="absolute inset-x-0 top-0 bg-white shadow-xl max-h-screen overflow-hidden">
        <div className="flex flex-col h-full max-h-screen">
          {/* Search Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center space-x-4">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="제품명이나 카테고리로 검색해보세요"
                  className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                  autoFocus
                />
                <i className="ri-search-line absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
              </div>
              <button
                onClick={onClose}
                className="p-3 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <i className="ri-close-line text-xl"></i>
              </button>
            </div>
          </div>

          {/* Search Results */}
          <div className="flex-1 overflow-y-auto p-6">
            {searchQuery.trim() === '' ? (
              <div className="text-center py-12">
                <i className="ri-search-line text-gray-300 text-4xl mb-4"></i>
                <p className="text-gray-500 text-lg mb-2">제품을 검색해보세요</p>
                <p className="text-gray-400 text-sm">제품명이나 카테고리로 검색할 수 있습니다</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-12">
                <i className="ri-search-line text-gray-300 text-4xl mb-4"></i>
                <p className="text-gray-500 text-lg mb-2">검색 결과가 없습니다</p>
                <p className="text-gray-400 text-sm">다른 키워드로 검색해보세요</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <p className="text-gray-600">
                    '<span className="font-medium text-gray-900">{searchQuery}</span>' 검색 결과 {searchResults.length}개
                  </p>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {searchResults.map((product) => (
                    <div
                      key={product.id}
                      className="bg-white rounded-xl border border-gray-100 hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer"
                      onClick={() => handleProductClick(product.id)}
                    >
                      <div className="aspect-square overflow-hidden">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover object-top hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-pink-500 font-medium bg-pink-50 px-2 py-1 rounded-full">
                            {product.category}
                          </span>
                        </div>
                        <h3 className="font-semibold text-gray-800 mb-2 text-sm">{product.name}</h3>
                        <p className="text-lg font-bold text-gray-900">{product.price}</p>
                        <div className="flex gap-2 mt-3">
                          <button 
                            className="flex-1 bg-pink-500 hover:bg-pink-600 text-white py-2 px-3 rounded-lg font-medium transition-all duration-200 whitespace-nowrap cursor-pointer text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProductClick(product.id);
                            }}
                          >
                            상세보기
                          </button>
                          <button 
                            className="px-3 py-2 border border-pink-500 text-pink-500 hover:bg-pink-50 rounded-lg transition-all duration-200 cursor-pointer text-xs"
                            onClick={(e) => addToCart(product, e)}
                            title="장바구니에 담기"
                          >
                            <i className="ri-shopping-cart-line"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
