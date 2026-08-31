/**
 * 컴포넌트 Props 관련 타입 정의
 */
import { ReactNode } from "react";

// 기본 컴포넌트 Props
export interface BaseComponentProps {
  className?: string;
  children?: ReactNode;
}

// 모달 컴포넌트 Props
export interface ModalProps extends BaseComponentProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

// 검색 모달 Props
export interface SearchModalProps extends ModalProps {
  // SearchModal에 특화된 추가 props가 있다면 여기에 정의
}

// 장바구니 모달 Props
export interface CartProps extends ModalProps {
  // Cart에 특화된 추가 props가 있다면 여기에 정의
}

// 버튼 Props (shadcn/ui Button 확장)
export interface ButtonProps extends BaseComponentProps {
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "pinkPrimary"
    | "pinkOutline"
    | "pinkSecondary"
    | "grayOutline"
    | "heroRounded";
  size?:
    | "default"
    | "sm"
    | "lg"
    | "xl"
    | "icon"
    | "heroButton"
    | "productButton"
    | "checkoutButton";
  disabled?: boolean;
  onClick?: () => void;
}

// 입력 필드 Props
export interface InputProps extends BaseComponentProps {
  type?: "text" | "email" | "password" | "number" | "tel" | "url";
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  required?: boolean;
}

// 라벨 Props
export interface LabelProps extends BaseComponentProps {
  htmlFor?: string;
  required?: boolean;
}

// 로딩 스피너 Props
export interface LoadingSpinnerProps extends BaseComponentProps {
  size?: "sm" | "md" | "lg";
  color?: "primary" | "secondary" | "white";
}

// 페이지 레이아웃 Props
export interface PageLayoutProps extends BaseComponentProps {
  title?: string;
  description?: string;
  showHeader?: boolean;
  showFooter?: boolean;
}
