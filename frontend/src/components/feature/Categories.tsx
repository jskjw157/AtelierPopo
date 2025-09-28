"use client";

import { useRouter } from "next/navigation";

const categories = [
  {
    id: 1,
    name: "에코백",
    description: "일상을 더 특별하게",
    image:
      "https://readdy.ai/api/search-image?query=Collection%20of%20handmade%20eco%20bags%20in%20various%20pastel%20colors%2C%20hanging%20display%2C%20clean%20white%20background%2C%20Korean%20style%20design%2C%20minimalist%20aesthetic%2C%20soft%20lighting%2C%20professional%20product%20photography&width=300&height=300&seq=cat1&orientation=squarish",
    count: "12개 제품",
  },
  {
    id: 2,
    name: "미니백",
    description: "작지만 완벽한",
    image:
      "https://readdy.ai/api/search-image?query=Cute%20mini%20bags%20collection%20in%20pastel%20colors%2C%20Korean%20handmade%20style%2C%20clean%20white%20background%2C%20bow%20details%2C%20delicate%20craftsmanship%2C%20professional%20product%20photography&width=300&height=300&seq=cat2&orientation=squarish",
    count: "8개 제품",
  },
  {
    id: 3,
    name: "파우치",
    description: "소중한 것들을 담아",
    image:
      "https://readdy.ai/api/search-image?query=Handmade%20pouches%20with%20floral%20patterns%2C%20organized%20display%2C%20pastel%20colors%2C%20clean%20white%20background%2C%20Korean%20craftsmanship%2C%20zipper%20details%2C%20professional%20product%20photography&width=300&height=300&seq=cat3&orientation=squarish",
    count: "15개 제품",
  },
  {
    id: 4,
    name: "베이비소품",
    description: "아기를 위한 특별함",
    image:
      "https://readdy.ai/api/search-image?query=Baby%20accessories%20handmade%20collection%2C%20soft%20pastel%20colors%2C%20cute%20animal%20motifs%2C%20clean%20white%20background%2C%20Korean%20style%20baby%20items%2C%20gentle%20materials%2C%20professional%20product%20photography&width=300&height=300&seq=cat4&orientation=squarish",
    count: "6개 제품",
  },
];

export default function Categories() {
  const router = useRouter();

  const handleCategoryClick = (categoryName: string) => {
    router.push(`/products?category=${encodeURIComponent(categoryName)}`);
  };

  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center mb-4">
            <div className="w-5 h-5 flex items-center justify-center mr-2">
              <i className="ri-grid-line text-pink-400"></i>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-800">
              제품 카테고리
            </h2>
            <div className="w-5 h-5 flex items-center justify-center ml-2">
              <i className="ri-grid-line text-pink-400"></i>
            </div>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto">
            다양한 종류의 핸드메이드 소품들을 카테고리별로 만나보세요
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {categories.map((category) => (
            <div
              key={category.id}
              className="group cursor-pointer"
              onClick={() => handleCategoryClick(category.name)}
            >
              <div className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all duration-300">
                <div className="aspect-square overflow-hidden rounded-xl mb-4">
                  <img
                    src={category.image}
                    alt={category.name}
                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">
                  {category.name}
                </h3>
                <p className="text-gray-600 mb-3">{category.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-pink-500 font-medium">
                    {category.count}
                  </span>
                  <div className="w-6 h-6 flex items-center justify-center">
                    <i className="ri-arrow-right-line text-gray-400 group-hover:text-pink-500 transition-colors"></i>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
