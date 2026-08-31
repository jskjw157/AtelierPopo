/**
 * 폼 관련 타입 정의
 */
import { SubmitStatus } from "./common";

// 결제 방법 타입
export type PaymentMethod = "card" | "bank" | "kakao" | "naver";

// 주문 폼 인터페이스
export interface OrderForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  detailAddress: string;
  zipCode: string;
  paymentMethod: PaymentMethod;
  memo: string;
}

// 연락처 폼 인터페이스
export interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

// 사용자 프로필 폼 인터페이스
export interface UserProfileForm {
  name: string;
  email: string;
  phone: string;
  address: string;
}

// 폼 상태 인터페이스
export interface FormState<T = any> {
  data: T;
  isSubmitting: boolean;
  submitStatus: SubmitStatus;
  errors?: Partial<Record<keyof T, string>>;
}

// 폼 검증 결과 인터페이스
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

// 폼 핸들러 타입
export type FormSubmitHandler<T = any> = (data: T) => Promise<void> | void;
export type FormChangeHandler<T = any> = (field: keyof T, value: any) => void;
