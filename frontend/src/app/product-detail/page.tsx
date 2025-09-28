"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

const allProducts = [
  {
    id: 1,
    name: "블루밍 에코백",
    price: "28,000원",
    originalPrice: "35,000원",
    image:
      "https://readdy.ai/api/search-image?query=Handmade%20cotton%20eco%20bag%20with%20delicate%20floral%20embroidery%2C%20pastel%20blue%20and%20pink%20colors%2C%20minimalist%20design%2C%20clean%20white%20background%2C%20soft%20lighting%2C%20detailed%20stitching%20visible%2C%20artisan%20craftsmanship%2C%20Korean%20style%20aesthetic%2C%20professional%20product%20photography&width=600&height=600&seq=eco1detail&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Handmade%20cotton%20eco%20bag%20with%20delicate%20floral%20embroidery%2C%20pastel%20blue%20and%20pink%20colors%2C%20minimalist%20design%2C%20clean%20white%20background%2C%20soft%20lighting%2C%20detailed%20stitching%20visible%2C%20artisan%20craftsmanship%2C%20Korean%20style%20aesthetic%2C%20professional%20product%20photography&width=600&height=600&seq=eco1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Cotton%20eco%20bag%20interior%20view%20showing%20quality%20lining%20and%20pockets%2C%20clean%20white%20background%2C%20Korean%20handcraft%20details%2C%20professional%20product%20photography&width=600&height=600&seq=eco1interior&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Eco%20bag%20styled%20with%20casual%20outfit%2C%20lifestyle%20photography%2C%20Korean%20aesthetic%2C%20natural%20lighting%2C%20clean%20background&width=600&height=600&seq=eco1lifestyle&orientation=squarish",
    ],
    category: "에코백",
    description:
      "일상을 더욱 특별하게 만들어주는 블루밍 에코백입니다. 부드러운 코튼 소재에 섬세한 플로럴 자수가 포인트로, 어떤 스타일링에도 완벽하게 어울립니다. 넉넉한 수납공간과 튼튼한 손잡이로 실용성도 뛰어납니다.",
    features: [
      "프리미엄 코튼 100% 소재",
      "핸드메이드 플로럴 자수",
      "넉넉한 수납공간 (40cm x 35cm)",
      "튼튼한 손잡이 (25cm)",
      "내부 작은 포켓 포함",
    ],
    colors: ["블루", "핑크", "화이트"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.8,
    reviews: 127,
  },
  {
    id: 2,
    name: "러블리 미니파우치",
    price: "15,000원",
    originalPrice: "18,000원",
    image:
      "https://readdy.ai/api/search-image?query=Small%20handmade%20fabric%20pouch%20with%20heart%20pattern%2C%20soft%20pink%20and%20cream%20colors%2C%20ribbon%20details%2C%20clean%20white%20background%2C%20minimalist%20styling%2C%20Korean%20handcraft%20aesthetic%2C%20delicate%20embroidery%2C%20professional%20product%20photography&width=600&height=600&seq=pouch1detail&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Small%20handmade%20fabric%20pouch%20with%20heart%20pattern%2C%20soft%20pink%20and%20cream%20colors%2C%20ribbon%20details%2C%20clean%20white%20background%2C%20minimalist%20styling%2C%20Korean%20handcraft%20aesthetic%2C%20delicate%20embroidery%2C%20professional%20product%20photography&width=600&height=600&seq=pouch1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Mini%20pouch%20opened%20showing%20interior%20compartments%2C%20clean%20white%20background%2C%20Korean%20handcraft%20quality%2C%20professional%20product%20photography&width=600&height=600&seq=pouch1open&orientation=squarish",
    ],
    category: "파우치",
    description:
      "사랑스러운 하트 패턴이 돋보이는 미니파우치입니다. 작지만 알찬 수납력으로 립스틱, 동전, 작은 소품들을 깔끔하게 정리할 수 있어요. 리본 디테일이 더욱 귀여운 매력을 더합니다.",
    features: [
      "부드러운 패브릭 소재",
      "핸드메이드 하트 자수",
      "컴팩트한 사이즈 (12cm x 8cm)",
      "리본 장식 디테일",
      "YKK 지퍼 사용",
    ],
    colors: ["핑크", "크림"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.9,
    reviews: 89,
  },
];

function ProductDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [product, setProduct] = useState<any>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [showAddedMessage, setShowAddedMessage] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);

  useEffect(() => {
    const productId = searchParams.get("id");

    if (productId) {
      const foundProduct = allProducts.find(
        (p) => p.id === parseInt(productId, 10)
      );
      if (foundProduct) {
        setProduct(foundProduct);
        setSelectedColor(foundProduct.colors?.[0] ?? "");
        setSelectedSize(foundProduct.sizes?.[0] ?? "");
        setSelectedImage(0);
      } else {
        console.warn(`Product with id ${productId} not found.`);
      }
    }
  }, [searchParams]);

  const addToCart = () => {
    if (!product) return;

    const cartItem = {
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity,
      color: selectedColor,
      size: selectedSize,
    };

    let existingCart = [];
    try {
      const stored = localStorage.getItem("cart");
      existingCart = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(existingCart)) {
        console.warn("Cart data malformed, resetting.");
        existingCart = [];
      }
    } catch (e) {
      console.error("Failed to parse cart from localStorage:", e);
      existingCart = [];
    }

    const existingItemIndex = existingCart.findIndex(
      (item: any) =>
        item.id === cartItem.id &&
        item.color === cartItem.color &&
        item.size === cartItem.size
    );

    if (existingItemIndex > -1) {
      existingCart[existingItemIndex].quantity += quantity;
    } else {
      existingCart.push(cartItem);
    }

    try {
      localStorage.setItem("cart", JSON.stringify(existingCart));
      window.dispatchEvent(new Event("cartUpdated"));
    } catch (e) {
      console.error("Failed to write cart to localStorage:", e);
    }

    setShowAddedMessage(true);
    setTimeout(() => setShowAddedMessage(false), 2000);
  };

  const handleOrder = () => {
    if (!product) return;

    addToCart();
    setShowOrderModal(true);
  };

  const closeOrderModal = () => {
    setShowOrderModal(false);
  };

  const proceedToCheckout = () => {
    setShowOrderModal(false);
    router.push("/products");
  };

  if (!product) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <i className="ri-search-line text-gray-300 text-4xl mb-4"></i>
          <p className="text-gray-500">제품을 찾을 수 없습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center space-x-2 text-sm text-gray-500 mb-8">
          <button
            onClick={() => router.push("/")}
            className="hover:text-pink-500 transition-colors cursor-pointer"
          >
            홈
          </button>
          <i className="ri-arrow-right-s-line"></i>
          <button
            onClick={() => router.push("/products")}
            className="hover:text-pink-500 transition-colors cursor-pointer"
          >
            제품
          </button>
          <i className="ri-arrow-right-s-line"></i>
          <span className="text-gray-800">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Product Images */}
          <div className="space-y-4">
            <div className="aspect-square overflow-hidden rounded-2xl bg-gray-50">
              <img
                src={product.images?.[selectedImage] ?? product.image}
                alt={product.name}
                className="w-full h-full object-cover object-top"
              />
            </div>

            {product.images?.length > 1 && (
              <div className="flex space-x-2">
                {product.images.map((image: string, index: number) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelectedImage(index)}
                    className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                      selectedImage === index
                        ? "border-pink-500"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <img
                      src={image}
                      alt={`${product.name} ${index + 1}`}
                      className="w-full h-full object-cover object-top"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            <div>
              <span className="text-pink-500 font-medium text-sm">
                {product.category}
              </span>
              <h1 className="text-3xl font-bold text-gray-900 mt-2">
                {product.name}
              </h1>
            </div>

            {/* Rating */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center">
                {[...Array(5)].map((_, i) => (
                  <i
                    key={i}
                    className={`ri-star-${
                      i < Math.floor(product.rating) ? "fill" : "line"
                    } text-yellow-400`}
                  ></i>
                ))}
              </div>
              <span className="text-gray-600">({product.reviews})</span>
            </div>

            {/* Price */}
            <div className="flex items-center space-x-3">
              <span className="text-3xl font-bold text-gray-900">
                {product.price}
              </span>
              {product.originalPrice && (
                <span className="text-lg text-gray-400 line-through">
                  {product.originalPrice}
                </span>
              )}
            </div>

            {/* Description */}
            <p className="text-gray-600 leading-relaxed">
              {product.description}
            </p>

            {/* Features */}
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">제품 특징</h3>
              <ul className="space-y-2">
                {product.features.map((feature: string, index: number) => (
                  <li
                    key={index}
                    className="flex items-center space-x-2 text-gray-600"
                  >
                    <i className="ri-check-line text-pink-500"></i>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Color Selection */}
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">색상</h3>
              <div className="flex space-x-2">
                {product.colors.map((color: string) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all cursor-pointer ${
                      selectedColor === color
                        ? "border-pink-500 bg-pink-50 text-pink-600"
                        : "border-gray-200 text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Selection */}
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">사이즈</h3>
              <div className="flex space-x-2">
                {product.sizes.map((size: string) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSelectedSize(size)}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all cursor-pointer ${
                      selectedSize === size
                        ? "border-pink-500 bg-pink-50 text-pink-600"
                        : "border-gray-200 text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">수량</h3>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
                  className="w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <i className="ri-subtract-line"></i>
                </button>
                <span className="text-lg font-medium w-12 text-center">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => prev + 1)}
                  className="w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <i className="ri-add-line"></i>
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-4 pt-6">
              <button
                type="button"
                onClick={addToCart}
                className="w-full bg-pink-100 hover:bg-pink-200 text-pink-700 py-4 rounded-lg font-semibold text-lg transition-all duration-200 whitespace-nowrap cursor-pointer relative border border-pink-200"
              >
                장바구니에 담기
                {showAddedMessage && (
                  <div className="absolute inset-0 bg-green-500 rounded-lg flex items-center justify-center text-white">
                    <i className="ri-check-line mr-2"></i>
                    장바구니에 추가됨!
                  </div>
                )}
              </button>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={handleOrder}
                  className="w-full bg-pink-500 hover:bg-pink-600 text-white py-3 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap cursor-pointer"
                >
                  주문하기
                </button>
                <button className="flex items-center justify-center space-x-2 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
                  <i className="ri-heart-line"></i>
                  <span>찜하기</span>
                </button>
              </div>
              <button className="w-full flex items-center justify-center space-x-2 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
                <i className="ri-share-line"></i>
                <span>공유하기</span>
              </button>
            </div>

            {/* Stock Status */}
            <div className="flex items-center space-x-2 text-sm">
              <i
                className={`ri-checkbox-circle-line ${
                  product.inStock ? "text-green-500" : "text-red-500"
                }`}
              ></i>
              <span
                className={product.inStock ? "text-green-600" : "text-red-600"}
              >
                {product.inStock ? "재고 있음" : "품절"}
              </span>
            </div>
          </div>
        </div>

        {/* Related Products */}
        <section className="mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">관련 제품</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {allProducts
              .filter((p) => p.id !== product.id)
              .slice(0, 4)
              .map((relatedProduct) => (
                <div
                  key={relatedProduct.id}
                  className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer"
                  onClick={() =>
                    router.push(`/product-detail?id=${relatedProduct.id}`)
                  }
                >
                  <div className="aspect-square overflow-hidden">
                    <img
                      src={relatedProduct.image}
                      alt={relatedProduct.name}
                      className="w-full h-full object-cover object-top hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-800 mb-2">
                      {relatedProduct.name}
                    </h3>
                    <p className="text-lg font-bold text-gray-900">
                      {relatedProduct.price}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>

      {/* Order Confirmation Modal */}
      {showOrderModal && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            className="absolute inset-0 bg-black bg-opacity-50"
            onClick={closeOrderModal}
          ></div>

          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-check-line text-green-500 text-2xl"></i>
                </div>

                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  주문이 접수되었습니다!
                </h3>
                <p className="text-gray-600 mb-6">
                  {product?.name} {quantity}개가 장바구니에 추가되었습니다.
                </p>

                <div className="bg-gray-50 rounded-lg p-4 mb-6">
                  <div className="flex items-center space-x-3">
                    <img
                      src={product?.image}
                      alt={product?.name}
                      className="w-12 h-12 object-cover object-top rounded-lg"
                    />
                    <div className="flex-1 text-left">
                      <h4 className="font-medium text-gray-900">
                        {product?.name}
                      </h4>
                      <p className="text-sm text-gray-500">
                        {selectedColor && `색상: ${selectedColor}`}
                        {selectedColor && selectedSize && " • "}
                        {selectedSize && `사이즈: ${selectedSize}`}
                      </p>
                      <p className="text-sm font-medium text-gray-900">
                        {product?.price} × {quantity}개
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={proceedToCheckout}
                    className="w-full bg-pink-500 hover:bg-pink-600 text-white py-3 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap cursor-pointer"
                  >
                    계속 쇼핑하기
                  </button>
                  <button
                    onClick={closeOrderModal}
                    className="w-full border border-gray-200 text-gray-700 hover:bg-gray-50 py-3 rounded-lg font-medium transition-all duration-200 whitespace-nowrap cursor-pointer"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}

export default function ProductDetail() {
  return (
    <div
      className="min-h-screen bg-white"
      style={{ fontFamily: "var(--font-inter), sans-serif" }}
    >
      <Suspense fallback={<div>Loading...</div>}>
        <ProductDetailContent />
      </Suspense>
    </div>
  );
}
