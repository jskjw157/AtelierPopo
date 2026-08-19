export class NaverProductsApi {
  constructor(client) { this.client = client; }

  create(payload) {
    return this.client.post('/v2/products', { json: payload, retrySafe: false });
  }

  getChannelProduct(channelProductNo) {
    return this.client.get(`/v2/products/channel-products/${encodeURIComponent(channelProductNo)}`);
  }

  searchBySellerManagementCode(code) {
    return this.client.post('/v1/products/search', {
      json: {
        searchKeywordType: 'SELLER_CODE',
        sellerManagementCode: code,
        page: 1,
        size: 50,
        orderType: 'NO'
      },
      retrySafe: true
    });
  }

  async findBySellerManagementCode(code) {
    const response = await this.searchBySellerManagementCode(code);
    const channelProducts = (response.contents || []).flatMap(item => item.channelProducts || []);
    return channelProducts.find(item => item.sellerManagementCode === code) || null;
  }

  getCategory(categoryId) {
    return this.client.get(`/v1/categories/${encodeURIComponent(categoryId)}`);
  }
}
