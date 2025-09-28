"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { allProducts, searchProducts } from "@/data/products";
import { useCart } from "@/hooks/useCart";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(allProducts);
  const router = useRouter();
  const { addToCart } = useCart();

  useEffect(() => {
    if (searchQuery.trim() === "") {
      setSearchResults(allProducts);
    } else {
      const results = searchProducts(searchQuery);
      setSearchResults(results);
    }
  }, [searchQuery]);

  const handleProductClick = (productId: number) => {
    onClose();
    router.push(`/product-detail?id=${productId}`);
  };

  const handleAddToCart = (product: any, event: React.MouseEvent) => {
    event.stopPropagation();

    addToCart({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity: 1,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      ></div>

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
            {searchQuery.trim() === "" ? (
              <div className="text-center py-12">
                <i className="ri-search-line text-gray-300 text-4xl mb-4"></i>
                <p className="text-gray-500 text-lg mb-2">
                  제품을 검색해보세요
                </p>
                <p className="text-gray-400 text-sm">
                  제품명이나 카테고리로 검색할 수 있습니다
                </p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-12">
                <i className="ri-search-line text-gray-300 text-4xl mb-4"></i>
                <p className="text-gray-500 text-lg mb-2">
                  검색 결과가 없습니다
                </p>
                <p className="text-gray-400 text-sm">
                  다른 키워드로 검색해보세요
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <p className="text-gray-600">
                    '
                    <span className="font-medium text-gray-900">
                      {searchQuery}
                    </span>
                    ' 검색 결과 {searchResults.length}개
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
                        <h3 className="font-semibold text-gray-800 mb-2 text-sm">
                          {product.name}
                        </h3>
                        <p className="text-lg font-bold text-gray-900">
                          {product.price}
                        </p>
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
                            onClick={(e) => handleAddToCart(product, e)}
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
