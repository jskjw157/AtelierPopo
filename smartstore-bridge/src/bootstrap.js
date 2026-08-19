import { loadConfig } from './config.js';
import { NaverCommerceClient } from './naver/client.js';
import { NaverProductsApi } from './naver/products.js';
import { Ledger } from './infrastructure/ledger.js';
import { ProductService } from './application/product-service.js';

export function bootstrap(configPath) {
  const config = loadConfig(configPath);
  const client = new NaverCommerceClient({
    clientId: config.naver.clientId,
    clientSecret: config.naver.clientSecret,
    tokenType: config.naver.tokenType,
    accountId: config.naver.accountId,
    baseUrl: config.naver.baseUrl
  });
  const productsApi = new NaverProductsApi(client);
  const ledger = new Ledger(config.databasePath);
  const productService = new ProductService({ config, client, productsApi, ledger });
  return { config, client, productsApi, ledger, productService };
}
