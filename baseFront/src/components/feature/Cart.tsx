
import { useState, useEffect } from 'react';

interface CartItem {
  id: number;
  name: string;
  price: string;
  image: string;
  quantity: number;
  color?: string;
  size?: string;
}

interface CartProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Cart({ isOpen, onClose }: CartProps) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  useEffect(() => {
    // 로컬 스토리지에서 장바구니 데이터 불러오기
    const savedCart = localStorage.getItem('cart');
    if (savedCart) {
      setCartItems(JSON.parse(savedCart));
    }
  }, [isOpen]);

  const updateQuantity = (id: number, newQuantity: number) => {
    if (newQuantity === 0) {
      removeItem(id);
      return;
    }
    
    const updatedItems = cartItems.map(item =>
      item.id === id ? { ...item, quantity: newQuantity } : item
    );
    setCartItems(updatedItems);
    localStorage.setItem('cart', JSON.stringify(updatedItems));
  };

  const removeItem = (id: number) => {
    const updatedItems = cartItems.filter(item => item.id !== id);
    setCartItems(updatedItems);
    localStorage.setItem('cart', JSON.stringify(updatedItems));
  };

  const getTotalPrice = () => {
    return cartItems.reduce((total, item) => {
      const price = parseInt(item.price.replace(/[^0-9]/g, ''), 10);
      return total + (price * item.quantity);
    }, 0);
  };

  const clearCart = () => {
    setCartItems([]);
    localStorage.removeItem('cart');
  };

  const handleCheckout = () => {
    onClose();
    if (window.REACT_APP_NAVIGATE) {
      window.REACT_APP_NAVIGATE('/checkout');
    } else {
      // fallback
      window.location.href = '/checkout';
    }
  };

  const handleShoppingRedirect = () => {
    onClose();
    if (window.REACT_APP_NAVIGATE) {
      window.REACT_APP_NAVIGATE('/products');
    } else {
      // fallback
      window.location.href = '/products';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
      
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">장바구니</h2>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            >
              <i className="ri-close-line text-xl"></i>
            </button>
          </div>

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-6">
            {cartItems.length === 0 ? (
              <div className="text-center py-16">
                <i className="ri-shopping-bag-line text-gray-300 text-4xl mb-4"></i>
                <p className="text-gray-500 mb-4">장바구니가 비어있습니다</p>
                <button
                  onClick={handleShoppingRedirect}
                  className="bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap cursor-pointer"
                >
                  쇼핑하러 가기
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {cartItems.map((item) => (
                  <div key={`${item.id}-${item.color}-${item.size}`} className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-16 h-16 object-cover object-top rounded-lg"
                    />
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">{item.name}</h3>
                      {item.color && (
                        <p className="text-sm text-gray-500">색상: {item.color}</p>
                      )}
                      {item.size && (
                        <p className="text-sm text-gray-500">사이즈: {item.size}</p>
                      )}
                      <p className="font-semibold text-gray-900">{item.price}</p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        <i className="ri-subtract-line text-sm"></i>
                      </button>
                      <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        <i className="ri-add-line text-sm"></i>
                      </button>
                    </div>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      <i className="ri-delete-bin-line"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {cartItems.length > 0 && (
            <div className="border-t border-gray-200 p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-gray-900">총 금액</span>
                <span className="text-xl font-bold text-gray-900">
                  {getTotalPrice().toLocaleString()}원
                </span>
              </div>
              
              <div className="space-y-3">
                <button 
                  onClick={handleCheckout}
                  className="w-full bg-pink-500 hover:bg-pink-600 text-white py-3 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap cursor-pointer"
                >
                  주문하기
                </button>
                <button
                  onClick={clearCart}
                  className="w-full border border-gray-200 text-gray-700 hover:bg-gray-50 py-3 rounded-lg font-medium transition-all duration-200 whitespace-nowrap cursor-pointer"
                >
                  장바구니 비우기
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
