"use client";

import { useRouter } from "next/navigation";
import { featuredProducts } from "@/data/products";

export default function FeaturedProducts() {
  const router = useRouter();

  return (
    <section id="products" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center mb-4">
            <div className="w-5 h-5 flex items-center justify-center mr-2">
              <i className="ri-star-line text-pink-400"></i>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-800">
              추천 제품
            </h2>
            <div className="w-5 h-5 flex items-center justify-center ml-2">
              <i className="ri-star-line text-pink-400"></i>
            </div>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto">
            정성스럽게 만든 핸드메이드 소품들을 만나보세요
          </p>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8"
          data-product-shop
        >
          {featuredProducts.map((product) => (
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
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <button
            onClick={() => router.push("/products")}
            className="bg-pink-500 hover:bg-pink-600 text-white px-8 py-3 rounded-full font-medium transition-all duration-300 shadow-lg hover:shadow-xl whitespace-nowrap cursor-pointer"
          >
            모든 제품 보기
          </button>
        </div>
      </div>
    </section>
  );
}
