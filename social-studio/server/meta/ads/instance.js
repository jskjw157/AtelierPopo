import {pool} from '../../db.js';
import {config} from '../../config.js';
import {encryptSecret,decryptSecret} from '../../security.js';
import {graphGet,graphPost} from '../client.js';
import {createAdsRuntime} from './runtime.js';
export const adsServices=createAdsRuntime({pool,config,get:graphGet,post:graphPost,encrypt:encryptSecret,decrypt:decryptSecret});
