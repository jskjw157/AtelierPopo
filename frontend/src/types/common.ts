/**
 * 공통 타입 정의
 */

// 기본 ID 타입
export type ID = number;

// 상태 관련 타입
export type LoadingState = "idle" | "loading" | "success" | "error";
export type SubmitStatus = "idle" | "success" | "error";

// 가격 관련 타입
export type Price = string; // "28,000원" 형식

// 이미지 URL 타입
export type ImageUrl = string;

// 날짜 문자열 타입 (YYYY.MM.DD 형식)
export type DateString = string;

// 기본 응답 타입
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// 페이지네이션 타입
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
