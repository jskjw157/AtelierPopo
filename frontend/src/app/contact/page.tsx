'use client';

import { useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export default function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      // 폼 데이터 검증
      if (!formData.name || !formData.email || !formData.message) {
        throw new Error('필수 항목을 모두 입력해주세요.');
      }

      if (formData.message.length > 500) {
        throw new Error('메시지는 500자 이내로 입력해주세요.');
      }

      // FormData 생성
      const submitData = new FormData();
      Object.entries(formData).forEach(([key, value]) => {
        submitData.append(key, value);
      });

      const response = await fetch('https://readdy.ai/api/form/submit/contact_form_67761b8b9b8b4', {
        method: 'POST',
        body: new URLSearchParams(submitData as any)
      });

      if (response.ok) {
        setSubmitStatus('success');
        setFormData({
          name: '',
          email: '',
          phone: '',
          subject: '',
          message: ''
        });
      } else {
        throw new Error('전송에 실패했습니다.');
      }
    } catch (error) {
      console.error('Form submission error:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
      <Header />
      
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-pink-50 to-purple-50 py-20">
        <div className="absolute inset-0 bg-black/5"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            문의하기
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            궁금한 점이나 제품에 대한 문의사항이 있으시면 언제든지 연락해주세요. 
            빠른 시일 내에 답변드리겠습니다.
          </p>
        </div>
      </section>

      {/* Contact Form Section */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Contact Information */}
            <div className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-6">연락처 정보</h2>
                <p className="text-gray-600 mb-8">
                  아래 연락처로 직접 문의하시거나 옆의 문의 양식을 작성해주세요.
                </p>
              </div>

              <div className="space-y-6">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i className="ri-map-pin-line text-pink-600 text-xl"></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">주소</h3>
                    <p className="text-gray-600">서울특별시 강남구 테헤란로 123<br />아틀리에 포포 본점</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i className="ri-phone-line text-pink-600 text-xl"></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">전화번호</h3>
                    <p className="text-gray-600">02-1234-5678</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i className="ri-mail-line text-pink-600 text-xl"></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">이메일</h3>
                    <p className="text-gray-600">contact@atelierpopo.com</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i className="ri-time-line text-pink-600 text-xl"></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">운영시간</h3>
                    <p className="text-gray-600">
                      월-금: 09:00 - 18:00<br />
                      토: 10:00 - 16:00<br />
                      일요일 및 공휴일 휴무
                    </p>
                  </div>
                </div>
              </div>

              {/* Social Links */}
              <div className="pt-8 border-t border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-4">소셜 미디어</h3>
                <div className="flex space-x-4">
                  <a href="#" className="w-10 h-10 bg-pink-100 rounded-lg flex items-center justify-center text-pink-600 hover:bg-pink-200 transition-colors cursor-pointer">
                    <i className="ri-instagram-line text-lg"></i>
                  </a>
                  <a href="#" className="w-10 h-10 bg-pink-100 rounded-lg flex items-center justify-center text-pink-600 hover:bg-pink-200 transition-colors cursor-pointer">
                    <i className="ri-facebook-line text-lg"></i>
                  </a>
                  <a href="#" className="w-10 h-10 bg-pink-100 rounded-lg flex items-center justify-center text-pink-600 hover:bg-pink-200 transition-colors cursor-pointer">
                    <i className="ri-kakao-talk-line text-lg"></i>
                  </a>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="bg-gray-50 rounded-2xl p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">문의 양식</h2>
              
              <form id="contact-form" data-readdy-form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                      이름 *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                      placeholder="홍길동"
                    />
                  </div>
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                      전화번호
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                      placeholder="010-1234-5678"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    이메일 *
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
                    placeholder="example@email.com"
                  />
                </div>

                <div>
                  <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                    문의 유형
                  </label>
                  <select
                    id="subject"
                    name="subject"
                    value={formData.subject}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm pr-8"
                  >
                    <option value="">문의 유형을 선택해주세요</option>
                    <option value="product">제품 문의</option>
                    <option value="order">주문 문의</option>
                    <option value="delivery">배송 문의</option>
                    <option value="return">교환/반품 문의</option>
                    <option value="collaboration">협업 제안</option>
                    <option value="other">기타 문의</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                    문의 내용 *
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    required
                    maxLength={500}
                    rows={6}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm resize-none"
                    placeholder="문의하실 내용을 자세히 적어주세요. (최대 500자)"
                  />
                  <div className="text-right text-xs text-gray-500 mt-1">
                    {formData.message.length}/500
                  </div>
                </div>

                {submitStatus === 'success' && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center">
                      <i className="ri-check-circle-line text-green-600 text-lg mr-2"></i>
                      <p className="text-green-800 text-sm">문의가 성공적으로 전송되었습니다. 빠른 시일 내에 답변드리겠습니다.</p>
                    </div>
                  </div>
                )}

                {submitStatus === 'error' && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center">
                      <i className="ri-error-warning-line text-red-600 text-lg mr-2"></i>
                      <p className="text-red-800 text-sm">문의 전송에 실패했습니다. 다시 시도해주세요.</p>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-pink-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-pink-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center">
                      <i className="ri-loader-4-line animate-spin mr-2"></i>
                      전송 중...
                    </span>
                  ) : (
                    '문의 보내기'
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Map Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">오시는 길</h2>
            <p className="text-gray-600">아틀리에 포포 본점으로 직접 방문하실 수 있습니다.</p>
          </div>
          
          <div className="bg-white rounded-2xl overflow-hidden shadow-lg">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3165.4!2d127.0276!3d37.4979!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x357ca15a1b1b1b1b%3A0x1b1b1b1b1b1b1b1b!2z7ISc7Jq47Yq567OE7IucIOqwleuCqOq1rCDthYztl6jtlZnroZwgMTIz!5e0!3m2!1sko!2skr!4v1234567890123"
              width="100%"
              height="400"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="아틀리에 포포 위치"
            ></iframe>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
