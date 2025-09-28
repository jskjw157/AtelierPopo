import Header from "@/components/layout/Header";
import Hero from "@/components/feature/Hero";
import FeaturedProducts from "@/components/feature/FeaturedProducts";
import About from "@/components/feature/About";
import Categories from "@/components/feature/Categories";
import InstagramGallery from "@/components/feature/InstagramGallery";
import Footer from "@/components/layout/Footer";

export default function Home() {
  return (
    <div
      className="min-h-screen bg-white"
      style={{ fontFamily: "var(--font-inter), sans-serif" }}
    >
      <Header />
      <Hero />
      <FeaturedProducts />
      <About />
      <Categories />
      <InstagramGallery />
      <Footer />
    </div>
  );
}
