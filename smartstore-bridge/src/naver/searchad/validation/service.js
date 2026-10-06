import { VALIDATION_STATES, freezeValidation, loadValidationRegistry } from './registry.js';
export class ValidationService {
  #registry;
  constructor({registry=loadValidationRegistry()}={}){this.#registry=freezeValidation(structuredClone(registry));Object.freeze(this);}
  list({state}={}) {
    if(state!==undefined&&!VALIDATION_STATES.includes(state))throw Object.assign(new Error('SearchAd validation state is invalid.'),{code:'SEARCHAD_VALIDATION_STATE_INVALID',status:400});
    const items=this.#registry.operations.filter(op=>state===undefined||op.state===state);
    return freezeValidation({specRef:this.#registry.specRef,descriptiveOnly:true,total:items.length,items,transportCapabilities:this.#registry.transportCapabilities});
  }
}
