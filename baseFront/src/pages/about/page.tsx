
import { useState } from 'react';
import Header from '../../components/feature/Header';
import Footer from '../../components/feature/Footer';

export default function About() {
  const [activeTab, setActiveTab] = useState('story');

  const teamMembers = [
    {
      name: '김민지',
      role: '대표 / 수석 디자이너',
      image: 'https://readdy.ai/api/search-image?query=professional%20asian%20woman%20artisan%20designer%20in%20bright%20modern%20atelier%20workshop%2C%20natural%20lighting%2C%20minimalist%20background%2C%20portrait%20style%2C%20warm%20colors&width=300&height=300&seq=about-team1&orientation=squarish',
      description: '10년간의 수공예 경험을 바탕으로 Atelier Popo를 창립했습니다. 전통 기법과 현대적 감성을 결합한 독창적인 작품을 선보입니다.',
    },
    {
      name: '박서현',
      role: '수공예 전문가',
      image: 'https://readdy.ai/api/search-image?query=talented%20asian%20woman%20craftsperson%20working%20with%20hands%20in%20bright%20atelier%2C%20focused%20expression%2C%20natural%20lighting%2C%20modern%20workspace%20background&width=300&height=300&seq=about-team2&orientation=squarish',
      description: '섬세한 손끝으로 하나하나 정성스럽게 제작하는 것이 저의 철학입니다. 고객의 특별한 순간을 위한 완벽한 작품을 만듭니다.',
    },
    {
      name: '이지우',
      role: '제품 개발 디렉터',
      image: 'https://readdy.ai/api/search-image?query=creative%20asian%20man%20designer%20sketching%20ideas%20in%20modern%20bright%20studio%2C%20contemporary%20workspace%2C%20natural%20lighting%2C%20professional%20appearance&width=300&height=300&seq=about-team3&orientation=squarish',
      description: '트렌드를 분석하고 새로운 디자인을 개발하여 브랜드의 혁신을 이끌어갑니다. 실용성과 아름다움의 완벽한 조화를 추구합니다.',
    },
  ];

  const values = [
    {
      icon: 'ri-heart-line',
      title: '정성과 사랑',
      description: '모든 제품에 진심과 정성을 담아 하나하나 수작업으로 제작합니다.',
    },
    {
      icon: 'ri-leaf-line',
      title: '친환경 소재',
      description: '자연에서 온 친환경 소재만을 사용하여 지속가능한 제품을 만듭니다.',
    },
    {
      icon: 'ri-star-line',
      title: '품질 보증',
      description: '엄격한 품질 관리를 통해 최고 품질의 제품만을 고객께 전달합니다.',
    },
    {
      icon: 'ri-user-heart-line',
      title: '고객 만족',
      description: '고객의 특별한 순간을 위해 맞춤형 서비스를 제공합니다.',
    },
  ];

  const milestones = [
    { year: '2018', event: 'Atelier Popo 창립' },
    { year: '2019', event: '첫 번째 컬렉션 론칭' },
    { year: '2020', event: '온라인 스토어 오픈' },
    { year: '2021', event: '맞춤 제작 서비스 시작' },
    { year: '2022', event: '친환경 소재 전환 완료' },
    { year: '2023', event: '해외 진출 시작' },
    { year: '2024', event: '브랜드 리뉴얼 및 확장' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      {/* Hero Section */}
      <section className="relative bg-white py-20">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url('https://readdy.ai/api/search-image?query=bright%20modern%20artisan%20workshop%20atelier%20with%20natural%20lighting%2C%20clean%20minimalist%20interior%2C%20crafting%20tools%20and%20materials%2C%20warm%20atmosphere%2C%20professional%20photography&width=1920&height=800&seq=about-hero&orientation=landscape')`,
          }}
        >
          <div className="absolute inset-0 bg-white/80"></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Atelier Popo 이야기
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            정성스러운 손끝에서 탄생하는 특별한 작품들. 
            전통과 현대가 만나는 아틀리에 포포에서 여러분만의 소중한 순간을 만들어보세요.
          </p>
        </div>
      </section>

      {/* Navigation Tabs */}
      <section className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8 overflow-x-auto">
            {[
              { id: 'story', label: '브랜드 스토리' },
              { id: 'process', label: '제작 과정' },
              { id: 'team', label: '팀 소개' },
              { id: 'values', label: '가치와 철학' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-2 whitespace-nowrap font-medium transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? 'text-pink-500 border-b-2 border-pink-500'
                    : 'text-gray-600 hover:text-pink-500'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </section>

      {/* Content Sections */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Brand Story */}
        {activeTab === 'story' && (
          <div className="space-y-16">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-6">
                  시작은 작은 꿈에서부터
                </h2>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  2018년, 작은 공방에서 시작된 Atelier Popo는 수공예의 아름다움을 현대적으로 재해석하겠다는 
                  꿈에서 출발했습니다. 기계가 만들어내는 획일화된 제품이 아닌, 사람의 손길이 닿은 
                  따뜻하고 특별한 작품을 만들고자 했습니다.
                </p>
                <p className="text-gray-600 leading-relaxed">
                  오늘날 Atelier Popo는 단순한 브랜드를 넘어 라이프스타일을 제안하는 공간으로 성장했습니다. 
                  고객 한 분 한 분의 특별한 순간을 위해 정성스럽게 제작하는 것이 저희의 변하지 않는 철학입니다.
                </p>
              </div>
              <div className="relative">
                <img
                  src="https://readdy.ai/api/search-image?query=cozy%20artisan%20workshop%20with%20handmade%20crafts%20and%20tools%2C%20warm%20lighting%2C%20vintage%20wooden%20furniture%2C%20creative%20atmosphere%2C%20professional%20photography&width=600&height=400&seq=about-story&orientation=landscape"
                  alt="아틀리에 포포의 시작"
                  className="rounded-lg shadow-lg object-cover w-full h-80"
                />
              </div>
            </div>

            {/* Timeline */}
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">성장의 발자취</h3>
              <div className="relative">
                <div className="absolute left-1/2 transform -translate-x-px h-full w-0.5 bg-pink-200"></div>
                <div className="space-y-8">
                  {milestones.map((milestone, index) => (
                    <div key={index} className={`relative flex items-center ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                      <div className={`flex items-center space-x-4 ${index % 2 === 0 ? 'flex-row' : 'flex-row-reverse space-x-reverse'}`}>
                        <div className={`bg-white rounded-lg shadow-md p-4 max-w-xs ${index % 2 === 0 ? 'mr-8' : 'ml-8'}`}>
                          <div className="text-pink-500 font-bold text-lg">{milestone.year}</div>
                          <div className="text-gray-700">{milestone.event}</div>
                        </div>
                      </div>
                      <div className="absolute left-1/2 transform -translate-x-1/2 w-4 h-4 bg-pink-500 rounded-full border-4 border-white shadow"></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Process */}
        {activeTab === 'process' && (
          <div className="space-y-16">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                정성스러운 제작 과정
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                모든 제품은 숙련된 장인의 손을 거쳐 하나하나 정성스럽게 제작됩니다. 
                전통 기법과 현대적 감성이 만나는 특별한 과정을 소개합니다.
              </p>
            </div>

            {/* Video Section */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="aspect-video bg-gray-900 relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-20 h-20 bg-pink-500/20 rounded-full flex items-center justify-center mb-4 mx-auto">
                      <i className="ri-play-fill text-pink-500 text-3xl ml-1"></i>
                    </div>
                    <p className="text-white text-lg mb-2">수작업 제작 과정</p>
                    <p className="text-gray-300 text-sm">실제 제작 영상을 여기에 삽입해주세요</p>
                  </div>
                </div>
              </div>
              <div className="p-8">
                <h3 className="text-xl font-bold text-gray-900 mb-4">
                  장인의 손끝에서 탄생하는 작품
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  각 제품은 디자인 스케치부터 완성까지 평균 2-3주의 시간이 소요됩니다. 
                  소재 선별, 패턴 제작, 수작업 조립, 품질 검수까지 모든 과정에서 
                  장인의 세심한 손길이 닿습니다.
                </p>
              </div>
            </div>

            {/* Process Steps */}
            <div className="grid md:grid-cols-4 gap-8">
              {[
                {
                  step: '01',
                  title: '디자인 & 기획',
                  description: '고객의 요구사항을 반영한 맞춤 디자인 설계',
                  image: 'https://readdy.ai/api/search-image?query=designer%20sketching%20creative%20ideas%20on%20paper%20in%20bright%20modern%20studio%2C%20professional%20drawing%20tools%2C%20clean%20workspace%2C%20natural%20lighting&width=300&height=200&seq=process-1&orientation=landscape',
                },
                {
                  step: '02',
                  title: '소재 선별',
                  description: '엄선된 친환경 소재만을 사용한 재료 준비',
                  image: 'https://readdy.ai/api/search-image?query=various%20high%20quality%20natural%20materials%20and%20fabrics%20laid%20out%20on%20wooden%20table%2C%20organized%20crafting%20supplies%2C%20bright%20workshop%20lighting&width=300&height=200&seq=process-2&orientation=landscape',
                },
                {
                  step: '03',
                  title: '수작업 제작',
                  description: '숙련된 장인의 정성스러운 수작업 제작',
                  image: 'https://readdy.ai/api/search-image?query=skilled%20artisan%20hands%20carefully%20crafting%20handmade%20product%20in%20bright%20workshop%2C%20detailed%20close-up%2C%20professional%20tools%2C%20focused%20work&width=300&height=200&seq=process-3&orientation=landscape',
                },
                {
                  step: '04',
                  title: '품질 검수',
                  description: '완벽한 품질을 위한 최종 검수 및 포장',
                  image: 'https://readdy.ai/api/search-image?query=quality%20control%20inspection%20of%20handmade%20products%20in%20modern%20workshop%2C%20careful%20examination%2C%20professional%20packaging%2C%20bright%20clean%20environment&width=300&height=200&seq=process-4&orientation=landscape',
                },
              ].map((process, index) => (
                <div key={index} className="text-center">
                  <div className="relative mb-6">
                    <img
                      src={process.image}
                      alt={process.title}
                      className="w-full h-48 object-cover rounded-lg shadow-md"
                    />
                    <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2">
                      <div className="w-8 h-8 bg-pink-500 text-white rounded-full flex items-center justify-center font-bold text-sm">
                        {process.step}
                      </div>
                    </div>
                  </div>
                  <h4 className="font-bold text-gray-900 mb-2">{process.title}</h4>
                  <p className="text-gray-600 text-sm">{process.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team */}
        {activeTab === 'team' && (
          <div className="space-y-16">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Atelier Popo Team
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                각자의 전문성과 열정으로 브랜드를 이끌어가는 팀원들을 소개합니다.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {teamMembers.map((member, index) => (
                <div key={index} className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow">
                  <div className="aspect-square overflow-hidden">
                    <img
                      src={member.image}
                      alt={member.name}
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-1">{member.name}</h3>
                    <p className="text-pink-500 font-medium mb-4">{member.role}</p>
                    <p className="text-gray-600 text-sm leading-relaxed">{member.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Values */}
        {activeTab === 'values' && (
          <div className="space-y-16">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                우리의 가치와 철학
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                Atelier Popo가 추구하는 핵심 가치들입니다. 
                이러한 철학을 바탕으로 더 나은 제품과 서비스를 만들어갑니다.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {values.map((value, index) => (
                <div key={index} className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-shadow">
                  <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mb-6">
                    <i className={`${value.icon} text-pink-500 text-2xl`}></i>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">{value.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{value.description}</p>
                </div>
              ))}
            </div>

            {/* Mission Statement */}
            <div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-2xl p-12 text-center">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Our Mission</h3>
              <p className="text-lg text-gray-700 max-w-3xl mx-auto leading-relaxed">
                "정성스러운 손끝에서 탄생하는 특별한 작품을 통해 고객의 소중한 순간을 더욱 의미있게 만드는 것"
                <br /><br />
                우리는 단순한 제품을 만드는 것이 아니라, 고객의 특별한 순간과 함께할 소중한 추억을 
                창조한다고 믿습니다. 매일 성장하며 더 나은 가치를 전달하기 위해 노력하겠습니다.
              </p>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
