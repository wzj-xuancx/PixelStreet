/** Shared DOM-button contract for pointer, focus, pressed and disabled states. */
export class GameButton {
  private static enhanced=new WeakSet<HTMLElement>();
  private static generatedReason=new WeakMap<HTMLElement,string>();
  private static generatedDescription=new WeakMap<HTMLElement,string>();

  static enhance(button:HTMLElement):void{
    if(!button.classList.contains('game-button'))button.classList.add('game-button');
    if(button.dataset.tooltipOwner!=='custom')this.normalizeTooltip(button);
    this.syncDisabledReason(button);
    if(this.enhanced.has(button))return;
    this.enhanced.add(button);

    // aria-disabled is only descriptive by itself, so block activation at the
    // event boundary while preserving native disabled behavior for <button>.
    button.addEventListener('click',event=>{
      if(!isDisabled(button))return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },true);
    button.addEventListener('pointerdown',event=>{
      if(event.button===0&&!isDisabled(button))button.classList.add('is-pressed');
    });
    for(const event of ['pointerup','pointercancel','pointerleave','blur']){
      button.addEventListener(event,()=>button.classList.remove('is-pressed'));
    }
  }

  /**
   * `data-tooltip-owner="custom"` leaves tooltip/title data to the component,
   * which then owns both hover and focus details (remove native `title` if it
   * would duplicate that detail). `data-disabled-reason` separately exposes
   * disabled explanations when native disabled controls cannot receive focus.
   */
  private static normalizeTooltip(button:HTMLElement):void{
    const title=button.getAttribute('title');
    if(title){
      if(button.dataset.tooltip!==title)button.dataset.tooltip=title;
      button.removeAttribute('title');
    }
  }

  private static syncDisabledReason(button:HTMLElement):void{
    const disabled=isDisabled(button);
    const generated=this.generatedReason.get(button);
    const current=button.dataset.disabledReason;
    const hasExplicitReason=current!==undefined&&(!generated||current!==generated);
    const reason=hasExplicitReason?current:button.dataset.tooltip;

    if(disabled&&reason){
      if(!hasExplicitReason){
        if(button.dataset.disabledReason!==reason)button.dataset.disabledReason=reason;
        this.generatedReason.set(button,reason);
      }
      const generatedDescription=this.generatedDescription.get(button);
      const description=button.getAttribute('aria-description');
      if(description===null||(generatedDescription!==undefined&&description===generatedDescription)){
        if(description!==reason)button.setAttribute('aria-description',reason);
        this.generatedDescription.set(button,reason);
      }
      return;
    }

    if(generated!==undefined){
      if(button.dataset.disabledReason===generated)delete button.dataset.disabledReason;
      this.generatedReason.delete(button);
    }
    const generatedDescription=this.generatedDescription.get(button);
    if(generatedDescription!==undefined){
      if(button.getAttribute('aria-description')===generatedDescription)button.removeAttribute('aria-description');
      this.generatedDescription.delete(button);
    }
  }
}

type HintSource='pointer'|'focus';
let tip:HTMLDivElement|undefined;
let timer:ReturnType<typeof setTimeout>|undefined;
let key='';
let point={x:0,y:0};
let activeHint:{source:HintSource;target:HTMLElement}|undefined;
let installed=false;

function isDisabled(element:HTMLElement):boolean{
  return element.getAttribute('aria-disabled')==='true'||(element instanceof HTMLButtonElement&&element.disabled);
}
function hintTarget(node:EventTarget|null):HTMLElement|undefined{
  if(!(node instanceof Element))return;
  const target=node.closest<HTMLElement>('.game-button,[data-tooltip]');
  if(!target||target.dataset.tooltipOwner==='custom')return;
  return target;
}
function hintText(target:HTMLElement):string{
  return target.dataset.disabledReason??target.dataset.tooltip??target.getAttribute('aria-label')??target.textContent?.trim()??'';
}
function hintIdentity(target:HTMLElement):string{
  return target.id||target.dataset.tooltip||target.dataset.disabledReason||target.getAttribute('aria-label')||target.tagName;
}
function focusPoint(target:HTMLElement):{x:number;y:number}{
  const rect=target.getBoundingClientRect();
  return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};
}
function place():void{
  if(!tip||tip.hidden)return;
  const rect=tip.getBoundingClientRect();
  const x=Math.max(6,Math.min(innerWidth-rect.width-6,point.x+12));
  const y=point.y+24+rect.height<innerHeight?point.y+24:Math.max(4,point.y-rect.height-12);
  Object.assign(tip.style,{left:`${x}px`,top:`${y}px`});
}

export function showInteractionHint(text:string,x:number,y:number,identity=text):void{
  if(!tip)return;
  point={x,y};
  if(!text){clearTimeout(timer);activeHint=undefined;key='';tip.hidden=true;return;}
  const nextKey=`${identity}|${text}`;
  if(key===nextKey){place();return;}
  key=nextKey;
  clearTimeout(timer);
  tip.hidden=true;
  timer=setTimeout(()=>{
    if(!tip||key!==nextKey)return;
    tip.textContent=text;
    tip.hidden=false;
    place();
  },300);
}

export function clearPressedGameButtons():void{
  for(const button of Array.from(document.querySelectorAll<HTMLElement>('.game-button.is-pressed'))){
    button.classList.remove('is-pressed');
  }
}

export function installGameButtons():void{
  if(installed)return;
  installed=true;
  tip=document.createElement('div');
  tip.id='interactionHint';
  tip.className='interaction-hint';
  tip.setAttribute('role','tooltip');
  tip.hidden=true;
  document.body.append(tip);

  const scan=(node:Node):void=>{
    if(!(node instanceof Element))return;
    if(node.matches('button,[role="button"]'))GameButton.enhance(node as HTMLElement);
    for(const button of Array.from(node.querySelectorAll<HTMLElement>('button,[role="button"]'))){
      GameButton.enhance(button);
    }
    if(node instanceof HTMLElement&&node.hasAttribute('data-tooltip')&&node.hasAttribute('title')&&node.dataset.tooltipOwner!=='custom'){
      const title=node.getAttribute('title');
      if(title&&node.dataset.tooltip!==title)node.dataset.tooltip=title;
      node.removeAttribute('title');
    }
    for(const hint of Array.from(node.querySelectorAll<HTMLElement>('[data-tooltip][title]'))){
      if(hint.dataset.tooltipOwner==='custom')continue;
      const title=hint.getAttribute('title');
      if(title&&hint.dataset.tooltip!==title)hint.dataset.tooltip=title;
      hint.removeAttribute('title');
    }
  };
  scan(document.body);

  const refreshHint=():void=>{
    if(!activeHint)return;
    if(!activeHint.target.isConnected||activeHint.target.dataset.tooltipOwner==='custom'){
      activeHint=undefined;
      showInteractionHint('',0,0);
      return;
    }
    const position=activeHint.source==='focus'?focusPoint(activeHint.target):point;
    showInteractionHint(hintText(activeHint.target),position.x,position.y,hintIdentity(activeHint.target));
  };
  new MutationObserver(records=>{
    let hintChanged=false;
    for(const record of records){
      if(record.type==='attributes'){
        scan(record.target);
        if(['aria-label','aria-disabled','data-disabled-reason','data-tooltip','data-tooltip-owner','disabled','title'].includes(record.attributeName??''))hintChanged=true;
      }else{
        for(const node of Array.from(record.addedNodes))scan(node);
        hintChanged=true;
      }
    }
    if(hintChanged)refreshHint();
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','aria-disabled','data-disabled-reason','data-tooltip','data-tooltip-owner','disabled','title']});

  const hover=(event:PointerEvent):void=>{
    point={x:event.clientX,y:event.clientY};
    const underPointer=document.elementFromPoint(event.clientX,event.clientY);
    const target=hintTarget(underPointer??event.target);
    if(target){
      activeHint={source:'pointer',target};
      showInteractionHint(hintText(target),event.clientX,event.clientY,hintIdentity(target));
    }else if(activeHint?.source==='pointer'){
      activeHint=undefined;
      showInteractionHint('',0,0);
    }
  };
  document.addEventListener('pointerover',hover);
  document.addEventListener('pointermove',hover);
  document.addEventListener('pointerout',event=>{
    if(!event.relatedTarget&&activeHint?.source==='pointer'){
      activeHint=undefined;
      showInteractionHint('',0,0);
    }
  });
  document.addEventListener('focusin',event=>{
    const target=hintTarget(event.target);
    if(!target)return;
    activeHint={source:'focus',target};
    const position=focusPoint(target);
    showInteractionHint(hintText(target),position.x,position.y,hintIdentity(target));
  });
  document.addEventListener('focusout',event=>{
    if(activeHint?.source!=='focus')return;
    const target=hintTarget(event.target);
    if(target!==activeHint.target||hintTarget(event.relatedTarget)===target)return;
    activeHint=undefined;
    showInteractionHint('',0,0);
  });

  const clearForBackground=():void=>{
    clearPressedGameButtons();
    activeHint=undefined;
    showInteractionHint('',0,0);
  };
  window.addEventListener('pointerup',clearPressedGameButtons);
  window.addEventListener('pointercancel',clearPressedGameButtons);
  window.addEventListener('blur',clearForBackground);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden')clearForBackground();
  });
}
