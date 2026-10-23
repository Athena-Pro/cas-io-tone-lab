// Source PCM and analyzed features are immutable after loading. Retain those
// references instead of copying/encoding audio on every score replacement.
export class GridScoreUndo {
  #entry=null;
  get entry(){return this.#entry;}
  save(state,label,{restoreConfiguration=false}={}){
    if(!state?.samples)return null;
    const {samples,pieces,...controls}=state;
    return this.#entry={label,restoreConfiguration,state:{...structuredClone(controls),samples,pieces}};
  }
  consume(expected=this.#entry){
    if(!expected||expected!==this.#entry)return null;
    this.#entry=null;return expected;
  }
}
