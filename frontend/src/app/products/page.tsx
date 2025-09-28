"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { allProducts, categories } from "@/data/products";
import { useCart } from "@/hooks/useCart";

function ProductsContent() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [searchQuery, setSearchQuery] = useState("");

  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToCart } = useCart();

  useEffect(() => {
    const category = searchParams.get("category");
    const search = searchParams.get("search");

    if (category) {
      setSelectedCategory(category);
    }
    if (search) {
      setSearchQuery(search);
    }
  }, [searchParams]);

  const filteredProducts = allProducts.filter((product) => {
    const matchesCategory =
      selectedCategory === "all" || product.category === selectedCategory;
    const matchesSearch =
      searchQuery === "" ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

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

  return (
    <>
      <Header />

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-pink-50 to-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-4">
            모든 제품
          </h1>
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
                  key={category.value}
                  onClick={() => setSelectedCategory(category.value)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                    selectedCategory === category.value
                      ? "bg-pink-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-pink-100 hover:text-pink-600"
                  }`}
                >
                  {category.name}
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
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8"
            data-product-shop
          >
            {sortedProducts.map((product) => (
              <div
                key={product.id}
                className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer"
                onClick={() => router.push(`/product-detail?id=${product.id}`)}
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
                    <span className="text-sm text-pink-500 font-medium">
                      {product.category}
                    </span>
                    <div className="w-4 h-4 flex items-center justify-center">
                      <i className="ri-heart-line text-gray-300 hover:text-pink-400 transition-colors cursor-pointer"></i>
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">
                    {product.name}
                  </h3>
                  <p className="text-xl font-bold text-gray-900">
                    {product.price}
                  </p>
                  <div className="flex gap-2 mt-4">
                    <button
                      className="flex-1 bg-pink-500 hover:bg-pink-600 text-white py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/product-detail?id=${product.id}`);
                      }}
                    >
                      상세보기
                    </button>
                    <button
                      className="px-3 py-2 border border-pink-500 text-pink-500 hover:bg-pink-50 rounded-lg transition-all duration-200 cursor-pointer"
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

          {sortedProducts.length === 0 && (
            <div className="text-center py-16">
              <i className="ri-search-line text-gray-300 text-4xl mb-4"></i>
              <p className="text-gray-500">해당 조건에 맞는 제품이 없습니다.</p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </>
  );
}

export default function Products() {
  return (
    <div
      className="min-h-screen bg-white"
      style={{ fontFamily: "var(--font-inter), sans-serif" }}
    >
      <Suspense fallback={<div>Loading...</div>}>
        <ProductsContent />
      </Suspense>
    </div>
  );
}
