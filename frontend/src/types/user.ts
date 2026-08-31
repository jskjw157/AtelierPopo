/**
 * 사용자 관련 타입 정의
 */
import { ID, Price, ImageUrl, DateString } from "./common";

// 주문 상태 타입
export type OrderStatus =
  | "주문완료"
  | "결제완료"
  | "배송준비"
  | "배송중"
  | "배송완료"
  | "주문취소";

// 주문 아이템 인터페이스
export interface OrderItem {
  id: ID;
  name: string;
  price: Price;
  image: ImageUrl;
  quantity: number;
  orderDate: DateString;
  status: OrderStatus;
}

// 사용자 정보 인터페이스
export interface UserInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  joinDate: DateString;
}

// 사용자 프로필 인터페이스 (더 상세한 정보 포함)
export interface UserProfile extends UserInfo {
  id: ID;
  avatar?: ImageUrl;
  birthDate?: DateString;
  gender?: "male" | "female" | "other";
  preferences?: {
    newsletter: boolean;
    smsNotification: boolean;
    pushNotification: boolean;
  };
}

// 주문 내역 인터페이스
export interface OrderHistory {
  orders: OrderItem[];
  totalOrders: number;
  totalAmount: number;
}

// 위시리스트 아이템 인터페이스
export interface WishlistItem {
  id: ID;
  productId: ID;
  productName: string;
  productPrice: Price;
  productImage: ImageUrl;
  addedDate: DateString;
}

// 사용자 활동 통계 인터페이스
export interface UserStats {
  totalOrders: number;
  totalSpent: number;
  wishlistCount: number;
  reviewsCount: number;
  membershipLevel: "Bronze" | "Silver" | "Gold" | "Platinum";
}
