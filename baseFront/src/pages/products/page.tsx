
import { useState } from 'react';
import Header from '../../components/feature/Header';
import Footer from '../../components/feature/Footer';

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

const categories = [
  "전체",
  "에코백",
  "파우치",
  "데일리백",
  "헤어밴드",
  "베이비소품",
  "미니백",
  "크로스백",
  "지갑",
  "헤어핀",
  "숄더백",
  "키링",
  "클러치"
];

export default function Products() {
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [sortBy, setSortBy] = useState("name");

  const filteredProducts = allProducts.filter(
    (product) => selectedCategory === "전체" || product.category === selectedCategory
  );

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === "name") {
      return a.name.localeCompare(b.name);
    }
    if (sortBy === "price") {
      const priceA = parseInt(a.price.replace(/[^0-9]/g, ""), 10);
      const priceB = parseInt(b.price.replace(/[^0-9]/g, ""), 10);
      return priceA - priceB;
    }
    return 0;
  });

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

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      <Header />

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-pink-50 to-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-4">모든 제품</h1>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            정성스럽게 만든 핸드메이드 소품들을 한눈에 만나보세요
          </p>
        </div>
      </section>

      {/* Filter and Sort */}
      <section className="py-8 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            {/* Categories */}
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                    selectedCategory === category
                      ? "bg-pink-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-pink-100 hover:text-pink-600"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-4">
              <span className="text-gray-600 text-sm">정렬:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-pink-500 focus:border-transparent pr-8 cursor-pointer"
              >
                <option value="name">이름순</option>
                <option value="price">가격순</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Products Grid */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8" data-product-shop>
            {sortedProducts.map((product) => (
              <div
                key={product.id}
                className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer"
                onClick={() => window.REACT_APP_NAVIGATE(`/product-detail?id=${product.id}`)}
              >
                <div className="aspect-square overflow-hidden">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-full h-full object-cover object-top hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-pink-500 font-medium">{product.category}</span>
                    <div className="w-4 h-4 flex items-center justify-center">
                      <i className="ri-heart-line text-gray-300 hover:text-pink-400 transition-colors cursor-pointer"></i>
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">{product.name}</h3>
                  <p className="text-xl font-bold text-gray-900">{product.price}</p>
                  <div className="flex gap-2 mt-4">
                    <button 
                      className="flex-1 bg-pink-500 hover:bg-pink-600 text-white py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.REACT_APP_NAVIGATE(`/product-detail?id=${product.id}`);
                      }}
                    >
                      상세보기
                    </button>
                    <button 
                      className="px-3 py-2 border border-pink-500 text-pink-5

0 hover:bg-pink-50 rounded-lg transition-all duration-200 cursor-pointer"
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

          {sortedProducts.length === 0 && (
            <div className="text-center py-16">
              <i className="ri-search-line text-gray-300 text-4xl mb-4"></i>
              <p className="text-gray-500">해당 카테고리에 제품이 없습니다.</p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
