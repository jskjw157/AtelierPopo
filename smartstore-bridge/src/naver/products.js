export class NaverProductsApi {
  constructor(client) { this.client = client; }

  create(payload) {
    return this.client.post('/v2/products', { json: payload, retrySafe: false });
  }

  getChannelProduct(channelProductNo) {
    return this.client.get(`/v2/products/channel-products/${encodeURIComponent(channelProductNo)}`);
  }

  getOriginProduct(originProductNo) {
    return this.client.get(`/v2/products/origin-products/${encodeURIComponent(originProductNo)}`);
  }

  updateChannelProduct(channelProductNo, payload) {
    return this.client.put(`/v2/products/channel-products/${encodeURIComponent(channelProductNo)}`, {
      json: payload,
      retrySafe: false
    });
  }

  updateOriginProduct(originProductNo, payload) {
    return this.client.put(`/v2/products/origin-products/${encodeURIComponent(originProductNo)}`, {
      json: payload,
      retrySafe: false
    });
  }

  deleteChannelProduct(channelProductNo) {
    return this.client.delete(`/v2/products/channel-products/${encodeURIComponent(channelProductNo)}`, { retrySafe: false });
  }

  deleteOriginProduct(originProductNo) {
    return this.client.delete(`/v2/products/origin-products/${encodeURIComponent(originProductNo)}`, { retrySafe: false });
  }

  changeOriginProductStatus(originProductNo, payload) {
    return this.client.put(`/v1/products/origin-products/${encodeURIComponent(originProductNo)}/change-status`, {
      json: payload,
      retrySafe: false
    });
  }

  updateOriginProductOptionStock(originProductNo, payload) {
    return this.client.put(`/v1/products/origin-products/${encodeURIComponent(originProductNo)}/option-stock`, {
      json: payload,
      retrySafe: false
    });
  }

  multiUpdateOriginProducts(payload) {
    return this.client.patch('/v1/products/origin-products/multi-update', { json: payload, retrySafe: false });
  }

  bulkUpdateOriginProducts(payload) {
    return this.client.put('/v1/products/origin-products/bulk-update', { json: payload, retrySafe: false });
  }

  search(payload) {
    return this.client.post('/v1/products/search', { json: payload, retrySafe: true });
  }

  searchBySellerManagementCode(code) {
    return this.search({
      searchKeywordType: 'SELLER_CODE',
      sellerManagementCode: code,
      page: 1,
      size: 50,
      orderType: 'NO'
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

  getCategories(query) {
    return this.client.get('/v1/categories', { query });
  }
}
