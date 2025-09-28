export interface CartItem {
  id: number;
  name: string;
  price: string;
  image: string;
  quantity: number;
  color?: string;
  size?: string;
}

export interface AddToCartOptions {
  id: number;
  name: string;
  price: string;
  image: string;
  quantity?: number;
  color?: string;
  size?: string;
}

export interface CartHookReturn {
  // 상태
  cartItems: CartItem[];
  cartItemCount: number;
  totalPrice: number;
  isLoading: boolean;

  // 액션
  addToCart: (item: AddToCartOptions) => void;
  updateQuantity: (
    id: number,
    color: string | undefined,
    size: string | undefined,
    newQuantity: number
  ) => void;
  removeItem: (
    id: number,
    color: string | undefined,
    size: string | undefined
  ) => void;
  clearCart: () => void;

  // 유틸리티
  getShippingFee: () => number;
  getFinalTotal: () => number;
}
