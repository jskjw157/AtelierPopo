"use client";

import { useState, useEffect, useCallback } from "react";
import { CartItem, AddToCartOptions, CartHookReturn } from "@/types/cart";

const CART_STORAGE_KEY = "cart";
const CART_UPDATED_EVENT = "cartUpdated";

export function useCart(): CartHookReturn {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartItemCount, setCartItemCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // 로컬 스토리지에서 장바구니 데이터 로드
  const loadCartFromStorage = useCallback((): CartItem[] => {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY);
      if (!stored) return [];

      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("Failed to load cart from localStorage:", error);
      return [];
    }
  }, []);

  // 로컬 스토리지에 장바구니 데이터 저장
  const saveCartToStorage = useCallback((items: CartItem[]) => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
      // 커스텀 이벤트 발생을 다음 틱으로 지연
      setTimeout(() => {
        window.dispatchEvent(new Event(CART_UPDATED_EVENT));
      }, 0);
    } catch (error) {
      console.error("Failed to save cart to localStorage:", error);
    }
  }, []);

  // 장바구니 아이템 수 계산
  const calculateItemCount = useCallback((items: CartItem[]): number => {
    return items.reduce((total, item) => total + item.quantity, 0);
  }, []);

  // 총 가격 계산
  const calculateTotalPrice = useCallback((items: CartItem[]): number => {
    return items.reduce((total, item) => {
      const price = parseInt(item.price.replace(/[^0-9]/g, ""), 10);
      return total + price * item.quantity;
    }, 0);
  }, []);

  // 배송비 계산
  const getShippingFee = useCallback((): number => {
    const total = calculateTotalPrice(cartItems);
    return total >= 50000 ? 0 : 3000; // 5만원 이상 무료배송
  }, [cartItems, calculateTotalPrice]);

  // 최종 결제 금액 계산
  const getFinalTotal = useCallback((): number => {
    return calculateTotalPrice(cartItems) + getShippingFee();
  }, [cartItems, calculateTotalPrice, getShippingFee]);

  // 장바구니에 아이템 추가
  const addToCart = useCallback(
    (item: AddToCartOptions) => {
      const cartItem: CartItem = {
        id: item.id,
        name: item.name,
        price: item.price,
        image: item.image,
        quantity: item.quantity || 1,
        color: item.color || "",
        size: item.size || "",
      };

      setCartItems((prevItems) => {
        // 동일한 제품, 색상, 사이즈인 경우 수량 증가
        const existingItemIndex = prevItems.findIndex(
          (existingItem) =>
            existingItem.id === cartItem.id &&
            existingItem.color === cartItem.color &&
            existingItem.size === cartItem.size
        );

        let newItems: CartItem[];
        if (existingItemIndex > -1) {
          newItems = prevItems.map((existingItem, index) =>
            index === existingItemIndex
              ? {
                  ...existingItem,
                  quantity: existingItem.quantity + cartItem.quantity,
                }
              : existingItem
          );
        } else {
          newItems = [...prevItems, cartItem];
        }

        saveCartToStorage(newItems);
        return newItems;
      });
    },
    [saveCartToStorage]
  );

  // 수량 업데이트
  const updateQuantity = useCallback(
    (
      id: number,
      color: string | undefined,
      size: string | undefined,
      newQuantity: number
    ) => {
      if (newQuantity <= 0) {
        removeItem(id, color, size);
        return;
      }

      setCartItems((prevItems) => {
        const newItems = prevItems.map((item) =>
          item.id === id && item.color === color && item.size === size
            ? { ...item, quantity: newQuantity }
            : item
        );
        saveCartToStorage(newItems);
        return newItems;
      });
    },
    [saveCartToStorage]
  );

  // 아이템 제거
  const removeItem = useCallback(
    (id: number, color: string | undefined, size: string | undefined) => {
      setCartItems((prevItems) => {
        const newItems = prevItems.filter(
          (item) =>
            !(item.id === id && item.color === color && item.size === size)
        );
        saveCartToStorage(newItems);
        return newItems;
      });
    },
    [saveCartToStorage]
  );

  // 장바구니 전체 비우기
  const clearCart = useCallback(() => {
    setCartItems([]);
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
      // 커스텀 이벤트 발생을 다음 틱으로 지연
      setTimeout(() => {
        window.dispatchEvent(new Event(CART_UPDATED_EVENT));
      }, 0);
    } catch (error) {
      console.error("Failed to clear cart:", error);
    }
  }, []);

  // 초기 로드 및 이벤트 리스너 설정
  useEffect(() => {
    // 초기 로드
    const initialCart = loadCartFromStorage();
    setCartItems(initialCart);
    setCartItemCount(calculateItemCount(initialCart));
    setIsLoading(false);

    // 다른 탭/창에서의 변경사항 감지
    const handleStorageChange = () => {
      const updatedCart = loadCartFromStorage();
      setCartItems(updatedCart);
      setCartItemCount(calculateItemCount(updatedCart));
    };

    // 커스텀 이벤트 리스너
    const handleCartUpdate = () => {
      const updatedCart = loadCartFromStorage();
      setCartItems(updatedCart);
      setCartItemCount(calculateItemCount(updatedCart));
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(CART_UPDATED_EVENT, handleCartUpdate);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(CART_UPDATED_EVENT, handleCartUpdate);
    };
  }, [loadCartFromStorage, calculateItemCount]);

  // cartItems가 변경될 때마다 카운트 업데이트
  useEffect(() => {
    setCartItemCount(calculateItemCount(cartItems));
  }, [cartItems, calculateItemCount]);

  return {
    // 상태
    cartItems,
    cartItemCount,
    totalPrice: calculateTotalPrice(cartItems),
    isLoading,

    // 액션
    addToCart,
    updateQuantity,
    removeItem,
    clearCart,

    // 유틸리티
    getShippingFee,
    getFinalTotal,
  };
}
