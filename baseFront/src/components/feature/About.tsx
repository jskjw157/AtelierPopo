
export default function About() {
  return (
    <section id="about" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="flex items-center mb-6">
              <div className="w-5 h-5 flex items-center justify-center mr-3">
                <i className="ri-palette-line text-pink-400"></i>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-800">아틀리에 포포</h2>
            </div>
            
            <p className="text-lg text-gray-600 mb-6 leading-relaxed">
              손으로 만드는 것의 특별함을 믿습니다. 하나하나 정성스럽게 만든 제품들은 
              기계로는 표현할 수 없는 따뜻함과 개성을 담고 있어요.
            </p>
            
            <p className="text-gray-600 mb-8 leading-relaxed">
              일상 속 작은 행복을 선사하는 핸드메이드 소품들로 여러분의 하루하루가 
              더욱 특별해지길 바랍니다. 모든 제품은 친환경 소재를 사용하여 
              지구도 생각하는 마음으로 만들고 있습니다.
            </p>

            <div className="grid grid-cols-2 gap-6 mb-8">
              <div className="text-center p-4 bg-pink-50 rounded-xl">
                <div className="w-8 h-8 flex items-center justify-center mx-auto mb-2">
                  <i className="ri-hand-heart-line text-pink-500 text-2xl"></i>
                </div>
                <p className="font-semibold text-gray-800">핸드메이드</p>
                <p className="text-sm text-gray-600">정성스런 수작업</p>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-xl">
                <div className="w-8 h-8 flex items-center justify-center mx-auto mb-2">
                  <i className="ri-leaf-line text-green-500 text-2xl"></i>
                </div>
                <p className="font-semibold text-gray-800">친환경</p>
                <p className="text-sm text-gray-600">자연을 생각하는 소재</p>
              </div>
            </div>

            <button className="border-2 border-pink-500 text-pink-500 hover:bg-pink-500 hover:text-white px-8 py-3 rounded-full font-medium transition-all duration-300 whitespace-nowrap">
              더 알아보기
            </button>
          </div>

          <div className="relative">
            <img 
              src="https://readdy.ai/api/search-image?query=Cozy%20handcraft%20studio%20workspace%20with%20organized%20colorful%20fabrics%2C%20sewing%20tools%20neatly%20arranged%2C%20natural%20lighting%20from%20window%2C%20Korean%20style%20atelier%20interior%2C%20warm%20atmosphere%2C%20pastel%20color%20palette%2C%20crafting%20materials%2C%20professional%20interior%20photography&width=600&height=600&seq=about1&orientation=squarish"
              alt="아틀리에 포포 작업실"
              className="w-full rounded-2xl shadow-lg object-cover object-top"
            />
            <div className="absolute -top-6 -right-6 w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center">
              <i className="ri-scissors-line text-pink-500 text-xl"></i>
            </div>
            <div className="absolute -bottom-6 -left-6 w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
              <i className="ri-needle-line text-yellow-500 text-xl"></i>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
