import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorPool,validateCatalog,normalizeOrder,MAPS,SHOP_ORIGIN} from '../extension/queue.js';

const product={productId:'product00001',productName:'Demo',...MAPS[0],operatorUserId:'101'};
const config=catalog=>({version:1,shopOrigin:SHOP_ORIGIN,catalog});
const pool={...product,operatorUserIds:['101','102','103'],privateServerSourceUserId:'102'};

test('pool migration preserves legacy single account and explicit order without aliasing',()=>{
  assert.deepEqual(operatorPool(product),['101']);
  assert.deepEqual(operatorPool({...product,operatorUserId:''}),[]);
  const result=operatorPool(pool);assert.deepEqual(result,['101','102','103']);result.reverse();assert.deepEqual(pool.operatorUserIds,['101','102','103']);
  assert.deepEqual(operatorPool({...product,operatorUserIds:[]}),[]);
});

test('strict numeric unique bounded pool and private source validation',()=>{
  assert.equal(validateCatalog(config([pool])),true);
  for(const operatorUserIds of [['101','101'],[101],['0'],['01'],['1e3'],[' 101'],Array.from({length:21},(_,i)=>String(i+1)),null])assert.throws(()=>operatorPool({...product,operatorUserIds}),{code:'CONFIG_INVALID'});
  for(const privateServerSourceUserId of ['',102,'01','102x'])assert.throws(()=>validateCatalog(config([{...pool,privateServerSourceUserId}])),{code:'CONFIG_INVALID'});
  assert.equal(validateCatalog(config([{...pool,operatorUserId:'102'}])),true);
});

test('same-map products no longer need a shared pool; legacy shapes stay readable',()=>{
 const next={...pool,productId:'product00002'};
 assert.equal(validateCatalog(config([pool,next])),true);
 assert.equal(validateCatalog(config([product,{...product,productId:'product00002'}])),true);
 assert.equal(validateCatalog(config([pool,{...next,operatorUserIds:['101','103','102'],privateServerSourceUserId:'103'}])),true);
 assert.equal(validateCatalog(config([{...product,operatorUserId:'',operatorUserIds:[]}])),true);
 assert.throws(()=>validateCatalog(config([{...product},{...product}])),{code:'CONFIG_INVALID'});
});

test('normalization preserves ordered rotation and shared private source; legacy shape remains compatible',()=>{
  const row={id:'order000001',status:'PROCESSING',createdAt:'2026-11-16T10:00:00Z',variant:{id:product.productId,productGroup:{category:{id:product.categoryId}}}};
  const order=normalizeOrder(row,[pool]);
  assert.deepEqual(order.operatorUserIds,['101','102','103']);assert.equal(order.privateServerSourceUserId,'102');assert.equal(order.operatorUserId,'101');
  order.operatorUserIds.pop();assert.equal(pool.operatorUserIds.length,3);
  const legacy=normalizeOrder(row,[product]);assert.equal(legacy.operatorUserIds,undefined);assert.equal(legacy.privateServerSourceUserId,undefined);assert.deepEqual(operatorPool(legacy),['101']);
});
