
const galleryImages = [
  {
    id: 1,
    image: "https://readdy.ai/api/search-image?query=Instagram%20style%20photo%20of%20handmade%20eco%20bag%20being%20used%20in%20daily%20life%2C%20Korean%20lifestyle%20photography%2C%20natural%20lighting%2C%20aesthetic%20flat%20lay%2C%20pastel%20colors%2C%20clean%20composition&width=300&height=300&seq=insta1&orientation=squarish",
    likes: "124"
  },
  {
    id: 2,
    image: "https://readdy.ai/api/search-image?query=Behind%20the%20scenes%20crafting%20process%2C%20hands%20working%20on%20fabric%2C%20sewing%20machine%2C%20Korean%20artisan%20at%20work%2C%20warm%20natural%20lighting%2C%20Instagram%20style%20lifestyle%20photo&width=300&height=300&seq=insta2&orientation=squarish",
    likes: "89"
  },
  {
    id: 3,
    image: "https://readdy.ai/api/search-image?query=Flat%20lay%20of%20handmade%20pouches%20with%20flowers%2C%20aesthetic%20arrangement%2C%20pastel%20color%20palette%2C%20Instagram%20style%20product%20photography%2C%20Korean%20minimalist%20aesthetic&width=300&height=300&seq=insta3&orientation=squarish",
    likes: "156"
  },
  {
    id: 4,
    image: "https://readdy.ai/api/search-image?query=Customer%20photo%20using%20handmade%20mini%20bag%2C%20Korean%20fashion%20style%2C%20natural%20outdoor%20setting%2C%20Instagram%20lifestyle%20photography%2C%20authentic%20moment%20capture&width=300&height=300&seq=insta4&orientation=squarish",
    likes: "203"
  },
  {
    id: 5,
    image: "https://readdy.ai/api/search-image?query=Colorful%20fabric%20collection%20organized%20beautifully%2C%20crafting%20materials%2C%20Korean%20atelier%20workspace%2C%20Instagram%20style%20flat%20lay%20photography%2C%20pastel%20color%20scheme&width=300&height=300&seq=insta5&orientation=squarish",
    likes: "97"
  },
  {
    id: 6,
    image: "https://readdy.ai/api/search-image?query=Baby%20using%20handmade%20diaper%20pouch%2C%20cute%20baby%20accessories%2C%20Korean%20style%20baby%20photography%2C%20soft%20natural%20lighting%2C%20Instagram%20lifestyle%20photo&width=300&height=300&seq=insta6&orientation=squarish",
    likes: "178"
  }
];

export default function InstagramGallery() {
  return (
    <section id="gallery" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center mb-4">
            <div className="w-5 h-5 flex items-center justify-center mr-3">
              <i className="ri-instagram-line text-pink-400"></i>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-800">@atelier_popo</h2>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto">
            인스타그램에서 더 많은 작품들과 제작 과정을 만나보세요
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {galleryImages.map((item) => (
            <div key={item.id} className="group relative aspect-square overflow-hidden rounded-xl cursor-pointer">
              <img 
                src={item.image} 
                alt={`Gallery ${item.id}`}
                className="w-full h-full object-cover object-top group-hover:scale-110 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300"></div>
              <div className="absolute bottom-3 right-3 bg-black/70 text-white px-2 py-1 rounded-full flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="w-3 h-3 flex items-center justify-center">
                  <i className="ri-heart-fill text-xs"></i>
                </div>
                <span className="text-xs">{item.likes}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <button className="border-2 border-pink-500 text-pink-500 hover:bg-pink-500 hover:text-white px-8 py-3 rounded-full font-medium transition-all duration-300 inline-flex items-center space-x-2 whitespace-nowrap">
            <div className="w-4 h-4 flex items-center justify-center">
              <i className="ri-instagram-line"></i>
            </div>
            <span>인스타그램 팔로우</span>
          </button>
        </div>
      </div>
    </section>
  );
}
