/**
 * 장바구니 관련 타입 정의
 */
import { ID, Price, ImageUrl } from "./common";
import { ProductColor, ProductSize } from "./product";

// 장바구니 아이템 인터페이스
export interface CartItem {
  id: ID;
  name: string;
  price: Price;
  image: ImageUrl;
  quantity: number;
  color?: ProductColor;
  size?: ProductSize;
}

// 장바구니 추가 옵션 인터페이스
export interface AddToCartOptions {
  id: ID;
  name: string;
  price: Price;
  image: ImageUrl;
  quantity?: number;
  color?: ProductColor;
  size?: ProductSize;
}

// 장바구니 훅 반환 타입
export interface CartHookReturn {
  // 상태
  cartItems: CartItem[];
  cartItemCount: number;
  totalPrice: number;
  isLoading: boolean;

  // 액션
  addToCart: (item: AddToCartOptions) => void;
  updateQuantity: (
    id: ID,
    color: ProductColor | undefined,
    size: ProductSize | undefined,
    newQuantity: number
  ) => void;
  removeItem: (
    id: ID,
    color: ProductColor | undefined,
    size: ProductSize | undefined
  ) => void;
  clearCart: () => void;

  // 유틸리티
  getShippingFee: () => number;
  getFinalTotal: () => number;
}

// 배송 정보 인터페이스
export interface ShippingInfo {
  fee: number;
  freeShippingThreshold: number;
  estimatedDays: number;
}
