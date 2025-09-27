
import type { RouteObject } from "react-router-dom";
import NotFound from "../pages/NotFound";
import Home from "../pages/home/page";
import Products from "../pages/products/page";
import ProductDetail from "../pages/product-detail/page";
import Checkout from "../pages/checkout/page";
import MyPage from "../pages/mypage/page";
import LoginPage from "../pages/login/page";
import Contact from "../pages/contact/page";
import About from "../pages/about/page";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/products",
    element: <Products />,
  },
  {
    path: "/product-detail",
    element: <ProductDetail />,
  },
  {
    path: "/checkout",
    element: <Checkout />,
  },
  {
    path: "/mypage",
    element: <MyPage />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/contact",
    element: <Contact />,
  },
  {
    path: "/about",
    element: <About />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;
