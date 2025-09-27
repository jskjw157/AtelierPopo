
const products = [
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
    image: "https://readdy.ai/api/search-image?query=Baby%20diaper%20pouch%20handmade%20with%20soft%20pastel%20colors%2C%20cute%20animal%20motifs%2C%20clean%20white%20background%2C%20organized%20compartments%2C%20Korean%20style%20baby%20accessory%2C%20gentle%20colors%2C%20professional%20product%20photography&width=400&height=400&seq=baby1&orientation=squarish",
    category: "베이비소품"
  },
  {
    id: 6,
    name: "스위트 미니백",
    price: "32,000원",
    image: "https://readdy.ai/api/search-image?query=Small%20handmade%20bag%20with%20bow%20detail%2C%20pastel%20pink%20color%2C%20minimalist%20design%2C%20clean%20white%20background%2C%20Korean%20style%20craftsmanship%2C%20delicate%20stitching%2C%20professional%20product%20photography&width=400&height=400&seq=mini1&orientation=squarish",
    category: "미니백"
  }
];

export default function FeaturedProducts() {
  return (
    <section id="products" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center mb-4">
            <div className="w-5 h-5 flex items-center justify-center mr-2">
              <i className="ri-star-line text-pink-400"></i>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-800">추천 제품</h2>
            <div className="w-5 h-5 flex items-center justify-center ml-2">
              <i className="ri-star-line text-pink-400"></i>
            </div>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto">
            정성스럽게 만든 핸드메이드 소품들을 만나보세요
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8" data-product-shop>
          {products.map((product) => (
            <div key={product.id} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer">
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
                    <i className="ri-heart-line text-gray-300 hover:txt-pink-400 transition-colors cursor-pointer"></i>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">{product.name}</h3>
                <p className="text-xl font-bold text-gray-900">{product.price}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <button 
            onClick={() => window.REACT_APP_NAVIGATE('/products')}
            className="bg-pink-500 hover:bg-pink-600 text-white px-8 py-3 rounded-full font-medium transition-all duration-300 shadow-lg hover:shadow-xl whitespace-nowrap cursor-pointer"
          >
            모든 제품 보기
          </button>
        </div>
      </div>
    </section>
  );
}
