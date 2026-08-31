/**
 * 제품 관련 타입 정의
 */
import { ID, Price, ImageUrl } from "./common";

// 제품 카테고리 타입
export type ProductCategory =
  | "에코백"
  | "파우치"
  | "데일리백"
  | "헤어밴드"
  | "베이비소품"
  | "미니백"
  | "크로스백"
  | "지갑"
  | "헤어핀"
  | "숄더백"
  | "키링"
  | "클러치"
  | "토트백";

// 제품 색상 타입
export type ProductColor = string;

// 제품 사이즈 타입
export type ProductSize = string;

// 메인 제품 인터페이스
export interface Product {
  id: ID;
  name: string;
  price: Price;
  originalPrice?: Price;
  image: ImageUrl;
  images: ImageUrl[];
  category: ProductCategory;
  description: string;
  features: string[];
  colors: ProductColor[];
  sizes: ProductSize[];
  inStock: boolean;
  rating: number;
  reviews: number;
}

// 카테고리 옵션 인터페이스
export interface CategoryOption {
  name: string;
  value: ProductCategory | "all";
}

// 제품 필터 옵션
export interface ProductFilters {
  category: ProductCategory | "all";
  priceRange?: {
    min: number;
    max: number;
  };
  colors?: ProductColor[];
  sizes?: ProductSize[];
  inStock?: boolean;
}

// 제품 정렬 옵션
export type ProductSortOption = "name" | "price" | "rating" | "reviews";

// 제품 검색 결과
export interface ProductSearchResult {
  products: Product[];
  total: number;
  filters: ProductFilters;
  sortBy: ProductSortOption;
}
