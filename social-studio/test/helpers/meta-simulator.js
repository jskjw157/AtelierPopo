// Provider boundary simulator: real domain and PostgreSQL run above this fake HTTP layer.
export function metaSimulator() {
  let next=1000;const objects=new Map(),posts=[];
  const account={id:'act_123',name:'HAAR',currency:'KRW',timezone_name:'Asia/Seoul',account_status:1,user_tasks:['ADVERTISE']};
  return {objects,posts,account,
    async get(path) { if(path==='/act_123')return account;
      const edge=path.match(/^\/(\d+)\/(adsets|ads)$/);
      if(edge){const [,parent,type]=edge;return {data:[...objects.values()].filter(v=>type==='adsets'?v.campaign_id===parent&&!v.adset_id:!!v.adset_id&&(v.campaign_id===parent||v.adset_id===parent)).map(v=>structuredClone(v))};}
    const value=objects.get(path.slice(1));if(!value)throw new Error('unknown test provider object '+path);return structuredClone(value); },
    async post(path,token,params) {
      posts.push({path,params:structuredClone(params)});
      if(path.endsWith('/adimages'))return {images:{test:{hash:'image-hash'}}};
      if(/^\/\d+$/.test(path)){Object.assign(objects.get(path.slice(1)),params);return {success:true};}
      const id=String(next++),obj={...structuredClone(params),id,account_id:'123'};if(obj.creative?.creative_id)obj.creative={id:obj.creative.creative_id};objects.set(id,obj);return {id};
    }
  };
}
