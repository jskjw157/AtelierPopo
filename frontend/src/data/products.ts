export interface Product {
  id: number;
  name: string;
  price: string;
  originalPrice?: string;
  image: string;
  images: string[];
  category: string;
  description: string;
  features: string[];
  colors: string[];
  sizes: string[];
  inStock: boolean;
  rating: number;
  reviews: number;
}

export const allProducts: Product[] = [
  {
    id: 1,
    name: "블루밍 에코백",
    price: "28,000원",
    originalPrice: "35,000원",
    image:
      "https://readdy.ai/api/search-image?query=Handmade%20cotton%20eco%20bag%20with%20delicate%20floral%20embroidery%2C%20pastel%20blue%20and%20pink%20colors%2C%20minimalist%20design%2C%20clean%20white%20background%2C%20soft%20lighting%2C%20detailed%20stitching%20visible%2C%20artisan%20craftsmanship%2C%20Korean%20style%20aesthetic%2C%20professional%20product%20photography&width=400&height=400&seq=eco1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Handmade%20cotton%20eco%20bag%20with%20delicate%20floral%20embroidery%2C%20pastel%20blue%20and%20pink%20colors%2C%20minimalist%20design%2C%20clean%20white%20background%2C%20soft%20lighting%2C%20detailed%20stitching%20visible%2C%20artisan%20craftsmanship%2C%20Korean%20style%20aesthetic%2C%20professional%20product%20photography&width=600&height=600&seq=eco1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Cotton%20eco%20bag%20interior%20view%20showing%20quality%20lining%20and%20pockets%2C%20clean%20white%20background%2C%20Korean%20handcraft%20details%2C%20professional%20product%20photography&width=600&height=600&seq=eco1interior&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Eco%20bag%20styled%20with%20casual%20outfit%2C%20lifestyle%20photography%2C%20Korean%20aesthetic%2C%20natural%20lighting%2C%20clean%20background&width=600&height=600&seq=eco1lifestyle&orientation=squarish",
    ],
    category: "에코백",
    description:
      "일상을 더욱 특별하게 만들어주는 블루밍 에코백입니다. 부드러운 코튼 소재에 섬세한 플로럴 자수가 포인트로, 어떤 스타일링에도 완벽하게 어울립니다. 넉넉한 수납공간과 튼튼한 손잡이로 실용성도 뛰어납니다.",
    features: [
      "프리미엄 코튼 100% 소재",
      "핸드메이드 플로럴 자수",
      "넉넉한 수납공간 (40cm x 35cm)",
      "튼튼한 손잡이 (25cm)",
      "내부 작은 포켓 포함",
    ],
    colors: ["블루", "핑크", "화이트"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.8,
    reviews: 127,
  },
  {
    id: 2,
    name: "러블리 미니파우치",
    price: "15,000원",
    originalPrice: "18,000원",
    image:
      "https://readdy.ai/api/search-image?query=Small%20handmade%20fabric%20pouch%20with%20heart%20pattern%2C%20soft%20pink%20and%20cream%20colors%2C%20ribbon%20details%2C%20clean%20white%20background%2C%20minimalist%20styling%2C%20Korean%20handcraft%20aesthetic%2C%20delicate%20embroidery%2C%20professional%20product%20photography&width=400&height=400&seq=pouch1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Small%20handmade%20fabric%20pouch%20with%20heart%20pattern%2C%20soft%20pink%20and%20cream%20colors%2C%20ribbon%20details%2C%20clean%20white%20background%2C%20minimalist%20styling%2C%20Korean%20handcraft%20aesthetic%2C%20delicate%20embroidery%2C%20professional%20product%20photography&width=600&height=600&seq=pouch1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Mini%20pouch%20opened%20showing%20interior%20compartments%2C%20clean%20white%20background%2C%20Korean%20handcraft%20quality%2C%20professional%20product%20photography&width=600&height=600&seq=pouch1open&orientation=squarish",
    ],
    category: "파우치",
    description:
      "사랑스러운 하트 패턴이 돋보이는 미니파우치입니다. 작지만 알찬 수납력으로 립스틱, 동전, 작은 소품들을 깔끔하게 정리할 수 있어요. 리본 디테일이 더욱 귀여운 매력을 더합니다.",
    features: [
      "부드러운 패브릭 소재",
      "핸드메이드 하트 자수",
      "컴팩트한 사이즈 (12cm x 8cm)",
      "리본 장식 디테일",
      "YKK 지퍼 사용",
    ],
    colors: ["핑크", "크림"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.9,
    reviews: 89,
  },
  {
    id: 3,
    name: "데일리 캔버스백",
    price: "35,000원",
    originalPrice: "42,000원",
    image:
      "https://readdy.ai/api/search-image?query=Canvas%20daily%20bag%20handmade%20with%20natural%20beige%20color%2C%20simple%20minimal%20design%2C%20leather%20handles%2C%20clean%20white%20background%2C%20professional%20product%20photography%2C%20Korean%20style%20craftsmanship%2C%20soft%20shadows&width=400&height=400&seq=daily1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Canvas%20daily%20bag%20handmade%20with%20natural%20beige%20color%2C%20simple%20minimal%20design%2C%20leather%20handles%2C%20clean%20white%20background%2C%20professional%20product%20photography%2C%20Korean%20style%20craftsmanship%2C%20soft%20shadows&width=600&height=600&seq=daily1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Canvas%20bag%20interior%20showing%20multiple%20pockets%20and%20quality%20lining%2C%20clean%20white%20background%2C%20Korean%20handcraft%20details&width=600&height=600&seq=daily1interior&orientation=squarish",
    ],
    category: "데일리백",
    description:
      "심플하면서도 실용적인 데일리 캔버스백입니다. 자연스러운 베이지 컬러와 가죽 손잡이의 조합이 세련된 느낌을 연출합니다. 일상에서 필요한 모든 것을 담을 수 있는 넉넉한 공간을 제공합니다.",
    features: [
      "고급 캔버스 소재",
      "천연 가죽 손잡이",
      "넉넉한 수납공간 (38cm x 32cm)",
      "내부 지퍼 포켓 2개",
      "자석 단추 잠금",
    ],
    colors: ["베이지", "네이비"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.7,
    reviews: 156,
  },
  {
    id: 4,
    name: "플라워 곱창밴드",
    price: "8,000원",
    image:
      "https://readdy.ai/api/search-image?query=Handmade%20fabric%20hair%20scrunchie%20with%20small%20flower%20print%2C%20pastel%20colors%2C%20delicate%20pattern%2C%20clean%20white%20background%2C%20Korean%20style%20hair%20accessory%2C%20soft%20cotton%20material%2C%20professional%20product%20photography&width=400&height=400&seq=band1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Handmade%20fabric%20hair%20scrunchie%20with%20small%20flower%20print%2C%20pastel%20colors%2C%20delicate%20pattern%2C%20clean%20white%20background%2C%20Korean%20style%20hair%20accessory%2C%20soft%20cotton%20material%2C%20professional%20product%20photography&width=600&height=600&seq=band1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Hair%20scrunchie%20worn%20in%20hair%20showing%20usage%20and%20style%2C%20Korean%20aesthetic%2C%20natural%20lighting&width=600&height=600&seq=band1usage&orientation=squarish",
    ],
    category: "헤어밴드",
    description:
      "사랑스러운 꽃 패턴이 돋보이는 곱창밴드입니다. 부드러운 코튼 소재로 머리카락을 상하지 않게 보호하면서도 예쁜 포인트를 연출해줍니다. 다양한 헤어스타일에 활용 가능합니다.",
    features: [
      "부드러운 코튼 소재",
      "핸드메이드 꽃 패턴",
      "머리카락 손상 방지",
      "탄력성 우수",
      "세탁 가능",
    ],
    colors: ["핑크", "라벤더", "민트"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.6,
    reviews: 203,
  },
  {
    id: 5,
    name: "베이비 기저귀파우치",
    price: "22,000원",
    originalPrice: "26,000원",
    image:
      "https://readdy.ai/api/search-image?query=Baby%20diaper%20pouch%20handmade%20with%20soft%20pastel%20colors%2C%20cute%20animal%20motifs%2C%20clean%20white%20background%2C%20organized%20compartments%2C%20Korean%20style%20baby%20accessory%20gentle%20colors%2C%20professional%20product%20photography&width=400&height=400&seq=baby1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Baby%20diaper%20pouch%20handmade%20with%20soft%20pastel%20colors%2C%20cute%20animal%20motifs%2C%20clean%20white%20background%2C%20organized%20compartments%2C%20Korean%20style%20baby%20accessory%20gentle%20colors%2C%20professional%20product%20photography&width=600&height=600&seq=baby1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Baby%20diaper%20pouch%20opened%20showing%20organized%20compartments%20for%20diapers%20and%20supplies%2C%20clean%20background&width=600&height=600&seq=baby1open&orientation=squarish",
    ],
    category: "베이비소품",
    description:
      "귀여운 동물 모티프가 포인트인 베이비 기저귀파우치입니다. 기저귀와 물티슈, 크림 등을 체계적으로 정리할 수 있는 구획이 나뉘어져 있어 외출 시 매우 편리합니다. 부드러운 파스텔 컬러로 아기에게도 안전합니다.",
    features: [
      "친환경 소재 사용",
      "귀여운 동물 자수",
      "체계적인 수납 구획",
      "휴대용 손잡이",
      "물세탁 가능",
    ],
    colors: ["핑크", "블루", "옐로우"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.8,
    reviews: 134,
  },
  {
    id: 6,
    name: "스위트 미니백",
    price: "32,000원",
    originalPrice: "38,000원",
    image:
      "https://readdy.ai/api/search-image?query=Small%20handmade%20bag%20with%20bow%20detail%2C%20pastel%20pink%20color%2C%20minimalist%20design%20clean%20white%20background%20Korean%20style%20craftsmanship%20delicate%20stitching%20professional%20product%20photography&width=400&height=400&seq=mini1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Small%20handmade%20bag%20with%20bow%20detail%2C%20pastel%20pink%20color%2C%20minimalist%20design%20clean%20white%20background%20Korean%20style%20craftsmanship%20delicate%20stitching%20professional%20product%20photography&width=600&height=600&seq=mini1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Mini%20bag%20interior%20showing%20compact%20organization%20and%20quality%20lining%2C%20clean%20background&width=600&height=600&seq=mini1interior&orientation=squarish",
    ],
    category: "미니백",
    description:
      "달콤한 리본 디테일이 포인트인 스위트 미니백입니다. 작지만 꼭 필요한 소품들을 깔끔하게 수납할 수 있으며, 어떤 룩에도 사랑스러운 포인트를 더해줍니다. 데이트나 파티 등 특별한 순간에 완벽한 액세서리입니다.",
    features: [
      "프리미엄 패브릭 소재",
      "핸드메이드 리본 장식",
      "컴팩트한 사이즈 (20cm x 15cm)",
      "조절 가능한 체인 스트랩",
      "마그네틱 잠금",
    ],
    colors: ["핑크", "화이트", "라벤더"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.7,
    reviews: 98,
  },
  {
    id: 7,
    name: "로맨틱 크로스백",
    price: "42,000원",
    originalPrice: "48,000원",
    image:
      "https://readdy.ai/api/search-image?query=Romantic%20crossbody%20bag%20handmade%20with%20soft%20fabric%2C%20pastel%20colors%2C%20delicate%20lace%20details%2C%20clean%20white%20background%2C%20Korean%20style%20fashion%20accessory%20professional%20product%20photography&width=400&height=400&seq=cross1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Romantic%20crossbody%20bag%20handmade%20with%20soft%20fabric%2C%20pastel%20colors%2C%20delicate%20lace%20details%2C%20clean%20white%20background%2C%20Korean%20style%20fashion%20accessory%20professional%20product%20photography&width=600&height=600&seq=cross1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Crossbody%20bag%20showing%20adjustable%20strap%20and%20interior%20organization%2C%20clean%20background&width=600&height=600&seq=cross1strap&orientation=squarish",
    ],
    category: "크로스백",
    description:
      "로맨틱한 레이스 디테일이 아름다운 크로스백입니다. 부드러운 패브릭과 섬세한 레이스의 조합이 우아함을 연출하며, 조절 가능한 스트랩으로 편안한 착용감을 제공합니다. 일상에서 특별함을 더해주는 아이템입니다.",
    features: [
      "고급 패브릭 소재",
      "핸드메이드 레이스 디테일",
      "조절 가능한 스트랩",
      "넉넉한 수납공간 (25cm x 20cm)",
      "내부 포켓 구성",
    ],
    colors: ["크림", "라이트 핑크"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.9,
    reviews: 76,
  },
  {
    id: 8,
    name: "큐티 동전지갑",
    price: "12,000원",
    image:
      "https://readdy.ai/api/search-image?query=Small%20cute%20coin%20purse%20handmade%20with%20cartoon%20characters%2C%20bright%20colors%2C%20clean%20white%20background%20Korean%20style%20small%20accessory%20professional%20product%20photography&width=400&height=400&seq=coin1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Small%20cute%20coin%20purse%20handmade%20with%20cartoon%20characters%2C%20bright%20colors%2C%20clean%20white%20background%20Korean%20style%20small%20accessory%20professional%20product%20photography&width=600&height=600&seq=coin1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Coin%20purse%20opened%20showing%20interior%20compartments%20and%20zipper%20quality%2C%20clean%20background&width=600&height=600&seq=coin1open&orientation=squarish",
    ],
    category: "지갑",
    description:
      "귀여운 캐릭터가 포인트인 동전지갑입니다. 작은 크기지만 동전과 카드, 작은 소품들을 깔끔하게 정리할 수 있습니다. 밝고 발랄한 컬러로 기분까지 좋아지는 아이템입니다.",
    features: [
      "부드러운 패브릭 소재",
      "귀여운 캐릭터 자수",
      "컴팩트한 사이즈 (10cm x 8cm)",
      "지퍼 잠금",
      "키링 고리 포함",
    ],
    colors: ["옐로우", "핑크", "블루"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.5,
    reviews: 187,
  },
  {
    id: 9,
    name: "프린세스 헤어핀",
    price: "6,000원",
    image:
      "https://readdy.ai/api/search-image?query=Princess%20style%20handmade%20hair%20pins%20with%20pearl%20and%20ribbon%20details%2C%20pastel%20colors%2C%20clean%20white%20background%2C%20Korean%20style%20hair%20accessory%20delicate%20craftsmanship%20professional%20product%20photography&width=400&height=400&seq=pin1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Princess%20style%20handmade%20hair%20pins%20with%20pearl%20and%20ribbon%20details%2C%20pastel%20colors%2C%20clean%20white%20background%2C%20Korean%20style%20hair%20accessory%20delicate%20craftsmanship%20professional%20product%20photography&width=600&height=600&seq=pin1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Hair%20pins%20worn%20in%20styled%20hair%20showing%20elegant%20usage%2C%20Korean%20aesthetic%2C%20natural%20lighting&width=600&height=600&seq=pin1usage&orientation=squarish",
    ],
    category: "헤어핀",
    description:
      "프린세스처럼 우아한 헤어핀입니다. 진주와 리본 디테일이 섬세하게 조화를 이루어 특별한 날이나 평상시 모두 사용하기 좋습니다. 머리카락을 우아하게 고정하면서도 아름다운 포인트를 연출합니다.",
    features: [
      "진주 장식 디테일",
      "핸드메이드 리본",
      "머리카락 손상 방지",
      "안전한 클립 구조",
      "2개 세트 구성",
    ],
    colors: ["화이트", "크림", "핑크"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.8,
    reviews: 142,
  },
  {
    id: 10,
    name: "빈티지 숄더백",
    price: "38,000원",
    originalPrice: "44,000원",
    image:
      "https://readdy.ai/api/search-image?query=Vintage%20style%20shoulder%20bag%20handmade%20with%20natural%20linen%20fabric%2C%20neutral%20colors%2C%20clean%20white%20background%2C%20Korean%20style%20craftsmanship%20professional%20product%20photography&width=400&height=400&seq=shoulder1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Vintage%20style%20shoulder%20bag%20handmade%20with%20natural%20linen%20fabric%2C%20neutral%20colors%2C%20clean%20white%20background%2C%20Korean%20style%20craftsmanship%20professional%20product%20photography&width=600&height=600&seq=shoulder1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Vintage%20shoulder%20bag%20interior%20showing%20pockets%20and%20lining%2C%20clean%20background&width=600&height=600&seq=shoulder1interior&orientation=squarish",
    ],
    category: "숄더백",
    description:
      "빈티지한 감성이 매력적인 숄더백입니다. 천연 린넨 소재로 제작되어 자연스러운 질감을 자랑하며, 중성적인 컬러로 다양한 스타일에 잘 어울립니다. 시간이 지날수록 더욱 멋스러워지는 아이템입니다.",
    features: [
      "천연 린넨 소재",
      "빈티지 스타일 디자인",
      "조절 가능한 숄더 스트랩",
      "넉넉한 수납공간 (30cm x 25cm)",
      "내부 지퍼 포켓",
    ],
    colors: ["베이지", "브라운"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.6,
    reviews: 93,
  },
  {
    id: 11,
    name: "스마일 키링",
    price: "9,000원",
    image:
      "https://readdy.ai/api/search-image?query=Smile%20face%20keychain%20handmade%20with%20colorful%20felt%20fabric%2C%20cute%20design%2C%20clean%20white%20background%2C%20Korean%20style%20small%20accessory%20professional%20product%20photography&width=400&height=400&seq=key1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Smile%20face%20keychain%20handmade%20with%20colorful%20felt%20fabric%2C%20cute%20design%2C%20clean%20white%20background%2C%20Korean%20style%20small%20accessory%20professional%20product%20photography&width=600&height=600&seq=key1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Keychain%20attached%20to%20keys%20or%20bag%20showing%20practical%20usage%2C%20lifestyle%20photography&width=600&height=600&seq=key1usage&orientation=squarish",
    ],
    category: "키링",
    description:
      "밝은 미소가 인상적인 스마일 키링입니다. 컬러풀한 펠트 소재로 제작되어 부드러운 촉감을 자랑하며, 열쇠나 가방에 달면 기분 좋은 포인트가 됩니다. 선물용으로도 인기가 많은 아이템입니다.",
    features: [
      "부드러운 펠트 소재",
      "핸드메이드 자수",
      "튼튼한 키링 고리",
      "컴팩트한 사이즈",
      "다양한 컬러 선택",
    ],
    colors: ["옐로우", "핑크", "블루", "그린"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.4,
    reviews: 256,
  },
  {
    id: 12,
    name: "엘레강스 클러치",
    price: "45,000원",
    originalPrice: "52,000원",
    image:
      "https://readdy.ai/api/search-image?query=Elegant%20clutch%20bag%20handmade%20with%20silk%20fabric%2C%20sophisticated%20design%20clean%20white%20background%20Korean%20style%20luxury%20accessory%20professional%20product%20photography&width=400&height=400&seq=clutch1&orientation=squarish",
    images: [
      "https://readdy.ai/api/search-image?query=Elegant%20clutch%20bag%20handmade%20with%20silk%20fabric%2C%20sophisticated%20design%20clean%20white%20background%20Korean%20style%20luxury%20accessory%20professional%20product%20photography&width=600&height=600&seq=clutch1detail&orientation=squarish",
      "https://readdy.ai/api/search-image?query=Elegant%20clutch%20interior%20showing%20luxury%20lining%20and%20card%20slots%2C%20clean%20background&width=600&height=600&seq=clutch1interior&orientation=squarish",
    ],
    category: "클러치",
    description:
      "우아함의 극치를 보여주는 엘레강스 클러치입니다. 고급 실크 소재로 제작되어 세련된 광택을 자랑하며, 파티나 특별한 행사에 완벽한 액세서리입니다. 심플하면서도 고급스러운 디자인이 돋보입니다.",
    features: [
      "프리미엄 실크 소재",
      "세련된 미니멀 디자인",
      "고급 새틴 안감",
      "카드 슬롯 구성",
      "마그네틱 잠금",
    ],
    colors: ["블랙", "네이비", "와인"],
    sizes: ["원사이즈"],
    inStock: true,
    rating: 4.9,
    reviews: 67,
  },
];

// 카테고리 목록
export const categories = [
  { name: "전체", value: "all" },
  { name: "에코백", value: "에코백" },
  { name: "파우치", value: "파우치" },
  { name: "데일리백", value: "데일리백" },
  { name: "헤어밴드", value: "헤어밴드" },
  { name: "베이비소품", value: "베이비소품" },
  { name: "미니백", value: "미니백" },
  { name: "크로스백", value: "크로스백" },
  { name: "지갑", value: "지갑" },
  { name: "헤어핀", value: "헤어핀" },
  { name: "숄더백", value: "숄더백" },
  { name: "키링", value: "키링" },
  { name: "클러치", value: "클러치" },
];

// 특별 추천 제품 (FeaturedProducts용)
export const featuredProducts = allProducts.slice(0, 6);

// 유틸리티 함수들
export const getProductById = (id: number): Product | undefined => {
  return allProducts.find((product) => product.id === id);
};

export const getProductsByCategory = (category: string): Product[] => {
  if (category === "all") return allProducts;
  return allProducts.filter((product) => product.category === category);
};

export const searchProducts = (query: string): Product[] => {
  const lowercaseQuery = query.toLowerCase();
  return allProducts.filter(
    (product) =>
      product.name.toLowerCase().includes(lowercaseQuery) ||
      product.category.toLowerCase().includes(lowercaseQuery)
  );
};
